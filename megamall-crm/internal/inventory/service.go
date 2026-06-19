package inventory

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

// Service encapsulates all inventory mutation logic.
// Every mutation that touches inventory.quantity also inserts an immutable movement
// record inside the same DB transaction.
type Service struct {
	repo   *Repository
	logger *activity.Logger
}

func NewService(repo *Repository, logger *activity.Logger) *Service {
	return &Service{repo: repo, logger: logger}
}

// ─── Read ─────────────────────────────────────────────────────────────────────

func (s *Service) ListInventory(ctx context.Context, f ListInventoryFilter, p pagination.Params) ([]Inventory, int, error) {
	return s.repo.ListInventory(ctx, f, p)
}

func (s *Service) GetByWarehouse(ctx context.Context, warehouseID uuid.UUID, p pagination.Params) ([]Inventory, int, error) {
	return s.repo.GetByWarehouse(ctx, warehouseID, p)
}

func (s *Service) GetByProduct(ctx context.Context, productID uuid.UUID, p pagination.Params) ([]Inventory, int, error) {
	return s.repo.GetByProduct(ctx, productID, p)
}

func (s *Service) ListMovements(ctx context.Context, f ListMovementsFilter, p pagination.Params) ([]MovementRow, int, error) {
	return s.repo.ListMovements(ctx, f, p)
}

// ─── Receiving ────────────────────────────────────────────────────────────────

// Receive records a goods receipt: increases inventory quantity and creates a
// FIFO batch with the supplied unit cost.
// Transaction sequence:
//  1. SELECT FOR UPDATE on inventory row (create if missing)
//  2. UPDATE inventory.quantity += req.Quantity
//  3. INSERT movement (type=purchase)
//  4. INSERT inventory_batch linked to the movement
//  5. LogSync activity log
//  6. Commit
func (s *Service) Receive(ctx context.Context, actorID uuid.UUID, req CreateReceivingRequest) (*ReceivingResponse, error) {
	var resp *ReceivingResponse

	txErr := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inv, err := s.repo.GetOrCreateForUpdate(tx, ctx, req.WarehouseID, req.ProductID)
		if err != nil {
			return err
		}

		prevQty := inv.Quantity
		newQty := prevQty + req.Quantity

		if err := s.repo.UpdateQuantity(tx, ctx, inv.ID, newQty); err != nil {
			return err
		}

		reason := "Приёмка товара"
		if req.InvoiceNo != nil && *req.InvoiceNo != "" {
			reason += " · накладная " + *req.InvoiceNo
		}
		if req.Notes != nil && *req.Notes != "" {
			reason += " · " + *req.Notes
		}

		m := &Movement{
			ID:               uuid.New(),
			WarehouseID:      req.WarehouseID,
			ProductID:        req.ProductID,
			MovementType:     MovementPurchase,
			Quantity:         req.Quantity,
			PreviousQuantity: prevQty,
			NewQuantity:      newQty,
			Reason:           &reason,
			CreatedBy:        actorID,
		}
		if err := s.repo.InsertMovement(tx, ctx, m); err != nil {
			return err
		}

		b := &Batch{
			ID:                uuid.New(),
			WarehouseID:       req.WarehouseID,
			ProductID:         req.ProductID,
			ReceivedQuantity:  req.Quantity,
			RemainingQuantity: req.Quantity,
			UnitCost:          req.UnitCost,
			ReceivedAt:        m.CreatedAt,
			MovementID:        &m.ID,
			CreatedBy:         &actorID,
		}
		if err := s.repo.CreateBatch(tx, ctx, b); err != nil {
			return err
		}

		if err := s.logger.LogSync(tx, activity.Entry{
			ActorID:    &actorID,
			Action:     "receive",
			EntityType: "inventory",
			EntityID:   &inv.ID,
			AfterState: map[string]interface{}{
				"warehouse_id": req.WarehouseID,
				"product_id":   req.ProductID,
				"quantity":     newQty,
				"unit_cost":    req.UnitCost,
				"batch_id":     b.ID,
			},
			Reason: &reason,
		}); err != nil {
			return err
		}

		resp = &ReceivingResponse{
			MovementID: m.ID,
			Batch:      ToBatchResponse(b),
		}
		return nil
	})

	if txErr != nil {
		return nil, txErr
	}
	return resp, nil
}

// ─── Adjustment ───────────────────────────────────────────────────────────────

// Adjust sets inventory.quantity to req.NewQuantity and records a movement.
// FIFO behaviour:
//   - delta > 0: creates a batch with req.UnitCost (defaults to 0).
//   - delta < 0: consumes from oldest batches via FIFO.
//   - delta == 0: records a no-op movement only.
//
// Transaction sequence:
//  1. SELECT FOR UPDATE on inventory row (create if missing)
//  2. Compute delta; validate non-negative result
//  3. UPDATE inventory.quantity
//  4. INSERT adjustment record
//  5. INSERT movement record
//  6. Create batch (increase) or ConsumeFIFO (decrease)
//  7. LogSync activity log
//  8. Commit
func (s *Service) Adjust(ctx context.Context, actorID uuid.UUID, req CreateAdjustmentRequest) (*Adjustment, error) {
	var adj *Adjustment

	txErr := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inv, err := s.repo.GetOrCreateForUpdate(tx, ctx, req.WarehouseID, req.ProductID)
		if err != nil {
			return err
		}

		prevQty := inv.Quantity
		newQty := req.NewQuantity

		if newQty < 0 {
			return apperrors.BadRequest("new_quantity must be >= 0")
		}

		if err := s.repo.UpdateQuantity(tx, ctx, inv.ID, newQty); err != nil {
			return err
		}

		adj = &Adjustment{
			ID:               uuid.New(),
			WarehouseID:      req.WarehouseID,
			ProductID:        req.ProductID,
			PreviousQuantity: prevQty,
			NewQuantity:      newQty,
			Reason:           req.Reason,
			CreatedBy:        actorID,
		}
		if err := s.repo.InsertAdjustment(tx, ctx, adj); err != nil {
			return err
		}

		signedDelta := newQty - prevQty
		absDelta := signedDelta
		if absDelta < 0 {
			absDelta = -absDelta
		}
		movQty := absDelta
		if movQty == 0 {
			movQty = 1
		}

		m := &Movement{
			ID:               uuid.New(),
			WarehouseID:      req.WarehouseID,
			ProductID:        req.ProductID,
			MovementType:     MovementAdjustment,
			Quantity:         movQty,
			PreviousQuantity: prevQty,
			NewQuantity:      newQty,
			Reason:           &req.Reason,
			CreatedBy:        actorID,
		}
		if err := s.repo.InsertMovement(tx, ctx, m); err != nil {
			return err
		}

		// FIFO batch tracking for non-zero deltas.
		if signedDelta > 0 {
			unitCost := 0.0
			if req.UnitCost != nil {
				unitCost = *req.UnitCost
			}
			b := &Batch{
				ID:                uuid.New(),
				WarehouseID:       req.WarehouseID,
				ProductID:         req.ProductID,
				ReceivedQuantity:  signedDelta,
				RemainingQuantity: signedDelta,
				UnitCost:          unitCost,
				ReceivedAt:        m.CreatedAt,
				MovementID:        &m.ID,
				CreatedBy:         &actorID,
			}
			if err := s.repo.CreateBatch(tx, ctx, b); err != nil {
				return err
			}
		} else if signedDelta < 0 {
			if _, err = s.repo.ConsumeFIFO(tx, ctx, req.WarehouseID, req.ProductID, absDelta, m.ID); err != nil {
				return fmt.Errorf("adjustment FIFO consume: %w", err)
			}
		}

		return s.logger.LogSync(tx, activity.Entry{
			ActorID:    &actorID,
			Action:     "adjustment",
			EntityType: "inventory",
			EntityID:   &inv.ID,
			BeforeState: map[string]interface{}{
				"warehouse_id": req.WarehouseID,
				"product_id":   req.ProductID,
				"quantity":     prevQty,
			},
			AfterState: map[string]interface{}{
				"warehouse_id": req.WarehouseID,
				"product_id":   req.ProductID,
				"quantity":     newQty,
			},
			Reason: &req.Reason,
		})
	})

	if txErr != nil {
		return nil, txErr
	}
	return adj, nil
}

// ─── Writeoff ─────────────────────────────────────────────────────────────────

// Writeoff deducts qty from inventory.quantity and records a writeoff + movement.
// FIFO batches are consumed oldest-first; BatchConsumption records are inserted
// for full cost audit.
// Transaction sequence:
//  1. SELECT FOR UPDATE on inventory row
//  2. Validate available_quantity >= req.Quantity
//  3. UPDATE inventory.quantity
//  4. INSERT writeoff record
//  5. INSERT movement record (type=writeoff)
//  6. ConsumeFIFO → update batch remaining_quantities + insert consumptions
//  7. LogSync activity log
//  8. Commit
func (s *Service) Writeoff(ctx context.Context, actorID uuid.UUID, req CreateWriteoffRequest) (*Writeoff, error) {
	var wo *Writeoff

	txErr := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inv, err := s.repo.GetOrCreateForUpdate(tx, ctx, req.WarehouseID, req.ProductID)
		if err != nil {
			return err
		}

		if inv.AvailableQuantity < req.Quantity {
			return apperrors.BadRequest(fmt.Sprintf(
				"insufficient available stock: have %d, need %d",
				inv.AvailableQuantity, req.Quantity,
			))
		}

		prevQty := inv.Quantity
		newQty := prevQty - req.Quantity

		if err := s.repo.UpdateQuantity(tx, ctx, inv.ID, newQty); err != nil {
			return err
		}

		wo = &Writeoff{
			ID:          uuid.New(),
			WarehouseID: req.WarehouseID,
			ProductID:   req.ProductID,
			Quantity:    req.Quantity,
			Reason:      req.Reason,
			ApprovedBy:  req.ApprovedBy,
			CreatedBy:   actorID,
		}
		if err := s.repo.InsertWriteoff(tx, ctx, wo); err != nil {
			return err
		}

		m := &Movement{
			ID:               uuid.New(),
			WarehouseID:      req.WarehouseID,
			ProductID:        req.ProductID,
			MovementType:     MovementWriteoff,
			Quantity:         req.Quantity,
			PreviousQuantity: prevQty,
			NewQuantity:      newQty,
			Reason:           &req.Reason,
			CreatedBy:        actorID,
		}
		if err := s.repo.InsertMovement(tx, ctx, m); err != nil {
			return err
		}

		if _, err = s.repo.ConsumeFIFO(tx, ctx, req.WarehouseID, req.ProductID, req.Quantity, m.ID); err != nil {
			return fmt.Errorf("writeoff FIFO consume: %w", err)
		}

		return s.logger.LogSync(tx, activity.Entry{
			ActorID:    &actorID,
			Action:     "writeoff",
			EntityType: "inventory",
			EntityID:   &inv.ID,
			BeforeState: map[string]interface{}{
				"warehouse_id": req.WarehouseID,
				"product_id":   req.ProductID,
				"quantity":     prevQty,
			},
			AfterState: map[string]interface{}{
				"warehouse_id": req.WarehouseID,
				"product_id":   req.ProductID,
				"quantity":     newQty,
			},
			Reason: &req.Reason,
		})
	})

	if txErr != nil {
		return nil, txErr
	}
	return wo, nil
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

// Transfer moves qty units from one warehouse to another in a single transaction.
// FIFO batches are consumed from the source; equivalent batches (preserving cost)
// are created in the destination so inventory valuation stays accurate across moves.
// Transaction sequence:
//  1. Validate from != to
//  2. SELECT FOR UPDATE on source inventory row
//  3. Validate available_quantity >= qty
//  4. UPDATE source inventory.quantity -= qty
//  5. INSERT transfer_out movement
//  6. ConsumeFIFO source batches → get consumed [(qty, cost)] pairs
//  7. SELECT FOR UPDATE (or create) destination inventory row
//  8. UPDATE destination inventory.quantity += qty
//  9. INSERT transfer_in movement (reference_id = transfer_out.ID)
//
// 10. Create destination batches mirroring consumed source batches (preserving cost)
// 11. LogSync activity log
// 12. Commit
func (s *Service) Transfer(ctx context.Context, actorID uuid.UUID, req CreateTransferRequest) (*TransferResponse, error) {
	if req.FromWarehouseID == req.ToWarehouseID {
		return nil, apperrors.BadRequest("from_warehouse_id and to_warehouse_id must be different")
	}

	var resp *TransferResponse

	txErr := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// ── Source ────────────────────────────────────────────────────────────
		src, err := s.repo.GetOrCreateForUpdate(tx, ctx, req.FromWarehouseID, req.ProductID)
		if err != nil {
			return err
		}
		if src.AvailableQuantity < req.Quantity {
			return apperrors.BadRequest(fmt.Sprintf(
				"insufficient available stock in source warehouse: have %d, need %d",
				src.AvailableQuantity, req.Quantity,
			))
		}

		srcPrev := src.Quantity
		srcNew := srcPrev - req.Quantity

		if err := s.repo.UpdateQuantity(tx, ctx, src.ID, srcNew); err != nil {
			return err
		}

		outMovement := &Movement{
			ID:               uuid.New(),
			WarehouseID:      req.FromWarehouseID,
			ProductID:        req.ProductID,
			MovementType:     MovementTransferOut,
			Quantity:         req.Quantity,
			PreviousQuantity: srcPrev,
			NewQuantity:      srcNew,
			Reason:           req.Reason,
			CreatedBy:        actorID,
		}
		if err := s.repo.InsertMovement(tx, ctx, outMovement); err != nil {
			return err
		}

		// Consume source FIFO batches; ConsumeFIFO returns per-batch consumption records
		// which we use to mirror equivalent batches at the destination (cost chain preserved).
		consumptions, err := s.repo.ConsumeFIFO(tx, ctx, req.FromWarehouseID, req.ProductID, req.Quantity, outMovement.ID)
		if err != nil {
			return fmt.Errorf("transfer FIFO consume: %w", err)
		}

		// ── Destination ───────────────────────────────────────────────────────
		dst, err := s.repo.GetOrCreateForUpdate(tx, ctx, req.ToWarehouseID, req.ProductID)
		if err != nil {
			return err
		}

		dstPrev := dst.Quantity
		dstNew := dstPrev + req.Quantity

		if err := s.repo.UpdateQuantity(tx, ctx, dst.ID, dstNew); err != nil {
			return err
		}

		inMovement := &Movement{
			ID:               uuid.New(),
			WarehouseID:      req.ToWarehouseID,
			ProductID:        req.ProductID,
			MovementType:     MovementTransferIn,
			Quantity:         req.Quantity,
			PreviousQuantity: dstPrev,
			NewQuantity:      dstNew,
			Reason:           req.Reason,
			ReferenceID:      &outMovement.ID,
			CreatedBy:        actorID,
		}
		if err := s.repo.InsertMovement(tx, ctx, inMovement); err != nil {
			return err
		}

		// Back-link the out movement to the in movement.
		if err := tx.WithContext(ctx).
			Model(&Movement{}).
			Where("id = ?", outMovement.ID).
			UpdateColumn("reference_id", inMovement.ID).Error; err != nil {
			return fmt.Errorf("link transfer movements: %w", err)
		}

		// Mirror consumed source batch slices into destination, preserving unit cost.
		for _, c := range consumptions {
			b := &Batch{
				ID:                uuid.New(),
				WarehouseID:       req.ToWarehouseID,
				ProductID:         req.ProductID,
				ReceivedQuantity:  c.Quantity,
				RemainingQuantity: c.Quantity,
				UnitCost:          c.UnitCost,
				ReceivedAt:        inMovement.CreatedAt,
				MovementID:        &inMovement.ID,
				CreatedBy:         &actorID,
			}
			if err := s.repo.CreateBatch(tx, ctx, b); err != nil {
				return fmt.Errorf("create destination batch: %w", err)
			}
		}

		reason := ""
		if req.Reason != nil {
			reason = *req.Reason
		}
		if err := s.logger.LogSync(tx, activity.Entry{
			ActorID:    &actorID,
			Action:     "transfer",
			EntityType: "inventory",
			AfterState: map[string]interface{}{
				"from_warehouse_id":     req.FromWarehouseID,
				"to_warehouse_id":       req.ToWarehouseID,
				"product_id":            req.ProductID,
				"quantity":              req.Quantity,
				"transfer_out_movement": outMovement.ID,
				"transfer_in_movement":  inMovement.ID,
			},
			Reason: &reason,
		}); err != nil {
			return err
		}

		resp = &TransferResponse{
			TransferOutMovementID: outMovement.ID,
			TransferInMovementID:  inMovement.ID,
			FromWarehouseID:       req.FromWarehouseID,
			ToWarehouseID:         req.ToWarehouseID,
			ProductID:             req.ProductID,
			Quantity:              req.Quantity,
		}
		return nil
	})

	if txErr != nil {
		return nil, txErr
	}
	return resp, nil
}

// ─── Batch queries ────────────────────────────────────────────────────────────

func (s *Service) ListBatches(ctx context.Context, f BatchListFilter, onlyActive bool) ([]*Batch, error) {
	return s.repo.ListBatches(ctx, f.WarehouseID, f.ProductID, onlyActive)
}

func (s *Service) InventoryIntegrityCheck(ctx context.Context) ([]InventoryIntegrityDiscrepancy, error) {
	return s.repo.InventoryIntegrityCheck(ctx)
}
