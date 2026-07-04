package inventory

import (
	"context"
	"fmt"
	"strings"

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

func (s *Service) GetByProduct(ctx context.Context, productID uuid.UUID, p pagination.Params) ([]Inventory, int, error) {
	return s.repo.GetByProduct(ctx, productID, p)
}

func (s *Service) ListMovements(ctx context.Context, f ListMovementsFilter, p pagination.Params) ([]MovementRow, int, error) {
	return s.repo.ListMovements(ctx, f, p)
}

func (s *Service) ListReceivingEdits(ctx context.Context, movementID uuid.UUID) ([]ReceivingEditRow, error) {
	return s.repo.ListReceivingEdits(ctx, movementID)
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
		inv, err := s.repo.GetOrCreateForUpdate(tx, ctx, req.ProductID)
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
				"product_id": req.ProductID,
				"quantity":   newQty,
				"unit_cost":  req.UnitCost,
				"batch_id":   b.ID,
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

func (s *Service) UpdateReceiving(ctx context.Context, actorID, movementID uuid.UUID, req UpdateReceivingRequest) (*ReceivingResponse, error) {
	var resp *ReceivingResponse

	txErr := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		m, err := s.repo.GetMovementForUpdate(tx, ctx, movementID)
		if err != nil {
			return err
		}
		if m.MovementType != MovementPurchase && m.MovementType != MovementWriteoff {
			return apperrors.BadRequest("only receiving and writeoff movements can be edited")
		}
		if m.MovementType == MovementWriteoff {
			resp, err = s.updateWriteoffMovement(tx, ctx, actorID, m, req)
			return err
		}

		b, err := s.repo.GetBatchByMovementForUpdate(tx, ctx, movementID)
		if err != nil {
			return err
		}

		oldProductID := m.ProductID
		oldQuantity := m.Quantity
		oldUnitCost := b.UnitCost
		oldNote := receivingNoteFromReason(m.Reason)
		newNote := strings.TrimSpace(derefString(req.Notes))
		consumedQty := b.ReceivedQuantity - b.RemainingQuantity
		if req.Quantity < consumedQty {
			return apperrors.BadRequest(fmt.Sprintf(
				"cannot set receiving quantity below already consumed FIFO stock (%d)",
				consumedQty,
			))
		}
		if req.ProductID != oldProductID && consumedQty > 0 {
			return apperrors.BadRequest("cannot change product after this receiving batch was partially consumed")
		}

		if req.ProductID == oldProductID {
			inv, err := s.repo.GetOrCreateForUpdate(tx, ctx, oldProductID)
			if err != nil {
				return err
			}
			delta := req.Quantity - oldQuantity
			if inv.Quantity+delta < 0 {
				return apperrors.BadRequest("receiving edit would make stock negative")
			}
			if err := s.repo.UpdateQuantity(tx, ctx, inv.ID, inv.Quantity+delta); err != nil {
				return err
			}
		} else {
			oldInv, err := s.repo.GetOrCreateForUpdate(tx, ctx, oldProductID)
			if err != nil {
				return err
			}
			if oldInv.Quantity-oldQuantity < 0 {
				return apperrors.BadRequest("receiving edit would make old product stock negative")
			}
			if err := s.repo.UpdateQuantity(tx, ctx, oldInv.ID, oldInv.Quantity-oldQuantity); err != nil {
				return err
			}
			newInv, err := s.repo.GetOrCreateForUpdate(tx, ctx, req.ProductID)
			if err != nil {
				return err
			}
			if err := s.repo.UpdateQuantity(tx, ctx, newInv.ID, newInv.Quantity+req.Quantity); err != nil {
				return err
			}
		}

		m.ProductID = req.ProductID
		m.Quantity = req.Quantity
		m.NewQuantity = m.PreviousQuantity + req.Quantity
		reason := receivingReason(newNote)
		m.Reason = &reason
		if err := s.repo.UpdateMovement(tx, ctx, m); err != nil {
			return err
		}

		b.ProductID = req.ProductID
		b.ReceivedQuantity = req.Quantity
		b.RemainingQuantity = req.Quantity - consumedQty
		b.UnitCost = req.UnitCost
		if err := s.repo.UpdateBatch(tx, ctx, b); err != nil {
			return err
		}

		edit := &ReceivingEdit{
			ID:           uuid.New(),
			MovementID:   movementID,
			EditedBy:     actorID,
			OldProductID: oldProductID,
			NewProductID: req.ProductID,
			OldQuantity:  oldQuantity,
			NewQuantity:  req.Quantity,
			OldUnitCost:  oldUnitCost,
			NewUnitCost:  req.UnitCost,
			OldNote:      oldNote,
			NewNote:      newNote,
		}
		if err := s.repo.InsertReceivingEdit(tx, ctx, edit); err != nil {
			return err
		}

		if err := s.logger.LogSync(tx, activity.Entry{
			ActorID:    &actorID,
			Action:     "edit_receiving",
			EntityType: "inventory_movement",
			EntityID:   &movementID,
			BeforeState: map[string]interface{}{
				"product_id": oldProductID,
				"quantity":   oldQuantity,
				"unit_cost":  oldUnitCost,
				"notes":      oldNote,
			},
			AfterState: map[string]interface{}{
				"product_id": req.ProductID,
				"quantity":   req.Quantity,
				"unit_cost":  req.UnitCost,
				"notes":      newNote,
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

func (s *Service) updateWriteoffMovement(tx *gorm.DB, ctx context.Context, actorID uuid.UUID, m *Movement, req UpdateReceivingRequest) (*ReceivingResponse, error) {
	if req.ProductID != m.ProductID {
		return nil, apperrors.BadRequest("writeoff product cannot be changed")
	}

	oldProductID := m.ProductID
	oldQuantity := m.Quantity
	oldNote := derefString(m.Reason)
	newNote := strings.TrimSpace(derefString(req.Notes))
	if newNote == "" {
		newNote = "Списание товара"
	}

	inv, err := s.repo.GetOrCreateForUpdate(tx, ctx, oldProductID)
	if err != nil {
		return nil, err
	}

	if err := s.restoreFIFOConsumption(tx, ctx, m.ID); err != nil {
		return nil, err
	}

	restoredQty := inv.Quantity + oldQuantity
	availableAfterRestore := restoredQty - inv.ReservedQuantity
	if availableAfterRestore < req.Quantity {
		return nil, apperrors.BadRequest(fmt.Sprintf(
			"insufficient available stock after restoring writeoff: have %d, need %d",
			availableAfterRestore,
			req.Quantity,
		))
	}

	newQty := restoredQty - req.Quantity
	if err := s.repo.UpdateQuantity(tx, ctx, inv.ID, newQty); err != nil {
		return nil, err
	}

	m.Quantity = req.Quantity
	m.PreviousQuantity = restoredQty
	m.NewQuantity = newQty
	m.Reason = &newNote
	if err := s.repo.UpdateMovement(tx, ctx, m); err != nil {
		return nil, err
	}

	if _, err := s.repo.ConsumeFIFO(tx, ctx, oldProductID, req.Quantity, m.ID); err != nil {
		return nil, fmt.Errorf("writeoff edit FIFO consume: %w", err)
	}

	edit := &ReceivingEdit{
		ID:           uuid.New(),
		MovementID:   m.ID,
		EditedBy:     actorID,
		OldProductID: oldProductID,
		NewProductID: oldProductID,
		OldQuantity:  oldQuantity,
		NewQuantity:  req.Quantity,
		OldUnitCost:  0,
		NewUnitCost:  0,
		OldNote:      oldNote,
		NewNote:      newNote,
	}
	if err := s.repo.InsertReceivingEdit(tx, ctx, edit); err != nil {
		return nil, err
	}

	if err := s.logger.LogSync(tx, activity.Entry{
		ActorID:    &actorID,
		Action:     "edit_writeoff",
		EntityType: "inventory_movement",
		EntityID:   &m.ID,
		BeforeState: map[string]interface{}{
			"product_id": oldProductID,
			"quantity":   oldQuantity,
			"reason":     oldNote,
		},
		AfterState: map[string]interface{}{
			"product_id": oldProductID,
			"quantity":   req.Quantity,
			"reason":     newNote,
		},
		Reason: &newNote,
	}); err != nil {
		return nil, err
	}

	return &ReceivingResponse{MovementID: m.ID}, nil
}

func (s *Service) restoreFIFOConsumption(tx *gorm.DB, ctx context.Context, movementID uuid.UUID) error {
	consumptions, err := s.repo.ListBatchConsumptionsForMovementForUpdate(tx, ctx, movementID)
	if err != nil {
		return err
	}
	for _, consumption := range consumptions {
		batch, err := s.repo.GetBatchForUpdate(tx, ctx, consumption.BatchID)
		if err != nil {
			return err
		}
		if err := s.repo.UpdateBatchRemaining(tx, ctx, batch.ID, batch.RemainingQuantity+consumption.Quantity); err != nil {
			return err
		}
	}
	return s.repo.DeleteBatchConsumptionsByMovement(tx, ctx, movementID)
}

func receivingReason(note string) string {
	reason := "Приёмка товара"
	if note != "" {
		reason += " · " + note
	}
	return reason
}

func receivingNoteFromReason(reason *string) string {
	if reason == nil {
		return ""
	}
	text := strings.TrimSpace(*reason)
	for _, prefix := range []string{"Приёмка товара · ", "Приёмка товара"} {
		if strings.HasPrefix(text, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(text, prefix))
		}
	}
	return text
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
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
		inv, err := s.repo.GetOrCreateForUpdate(tx, ctx, req.ProductID)
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
			if _, err = s.repo.ConsumeFIFO(tx, ctx, req.ProductID, absDelta, m.ID); err != nil {
				return fmt.Errorf("adjustment FIFO consume: %w", err)
			}
		}

		return s.logger.LogSync(tx, activity.Entry{
			ActorID:    &actorID,
			Action:     "adjustment",
			EntityType: "inventory",
			EntityID:   &inv.ID,
			BeforeState: map[string]interface{}{
				"product_id": req.ProductID,
				"quantity":   prevQty,
			},
			AfterState: map[string]interface{}{
				"product_id": req.ProductID,
				"quantity":   newQty,
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
		inv, err := s.repo.GetOrCreateForUpdate(tx, ctx, req.ProductID)
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
			ID:         uuid.New(),
			ProductID:  req.ProductID,
			Quantity:   req.Quantity,
			Reason:     req.Reason,
			ApprovedBy: req.ApprovedBy,
			CreatedBy:  actorID,
		}
		if err := s.repo.InsertWriteoff(tx, ctx, wo); err != nil {
			return err
		}

		m := &Movement{
			ID:               uuid.New(),
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

		if _, err = s.repo.ConsumeFIFO(tx, ctx, req.ProductID, req.Quantity, m.ID); err != nil {
			return fmt.Errorf("writeoff FIFO consume: %w", err)
		}

		return s.logger.LogSync(tx, activity.Entry{
			ActorID:    &actorID,
			Action:     "writeoff",
			EntityType: "inventory",
			EntityID:   &inv.ID,
			BeforeState: map[string]interface{}{
				"product_id": req.ProductID,
				"quantity":   prevQty,
			},
			AfterState: map[string]interface{}{
				"product_id": req.ProductID,
				"quantity":   newQty,
			},
			Reason: &req.Reason,
		})
	})

	if txErr != nil {
		return nil, txErr
	}
	return wo, nil
}

// ─── Batch queries ────────────────────────────────────────────────────────────

func (s *Service) ListBatches(ctx context.Context, f BatchListFilter, onlyActive bool) ([]*Batch, error) {
	return s.repo.ListBatches(ctx, f.ProductID, onlyActive)
}

func (s *Service) InventoryIntegrityCheck(ctx context.Context) ([]InventoryIntegrityDiscrepancy, error) {
	return s.repo.InventoryIntegrityCheck(ctx)
}
