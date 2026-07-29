package warehouses

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/activity"
	"github.com/megamall/crm/internal/inventory"
	"github.com/megamall/crm/internal/orders"
	"github.com/megamall/crm/internal/products"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/pagination"
	"gorm.io/gorm"
)

type Service struct {
	repo      *Repository
	invRepo   *inventory.Repository
	ordersSvc *orders.Service
	prodRepo  *products.Repository
	userRepo  *users.Repository
	logger    *activity.Logger
	db        *gorm.DB
}

func NewService(
	repo *Repository,
	invRepo *inventory.Repository,
	ordersSvc *orders.Service,
	prodRepo *products.Repository,
	userRepo *users.Repository,
	logger *activity.Logger,
	db *gorm.DB,
) *Service {
	return &Service{repo: repo, invRepo: invRepo, ordersSvc: ordersSvc, prodRepo: prodRepo, userRepo: userRepo, logger: logger, db: db}
}

// AdjustForOrder implements orders.AdjustCourierWarehouseFn: the courier-side
// half of releasing/deducting an order's reservation once it has moved off
// the legacy main pool (see internal/orders.releaseInventory/deductInventory).
func (s *Service) AdjustForOrder(
	ctx context.Context, tx *gorm.DB, warehouseID, productID uuid.UUID,
	qtyDelta, reservedDelta int, movementType string,
	referenceID, actorID uuid.UUID, reason string,
) error {
	ci, err := s.repo.GetOrCreateCourierInventoryForUpdate(tx, ctx, warehouseID, productID)
	if err != nil {
		return err
	}
	newQty := ci.Quantity + qtyDelta
	newReserved := ci.ReservedQuantity + reservedDelta
	if newQty < 0 {
		return apperrors.BadRequest("ошибка склада курьера: количество не может стать отрицательным")
	}
	if newReserved < 0 {
		newReserved = 0
	}
	if err := s.repo.UpdateCourierInventory(tx, ctx, ci.ID, newQty, newReserved, ci.BlockedQuantity); err != nil {
		return err
	}
	refType := RefTypeOrder
	rsn := reason
	mv := &CourierInventoryMovement{
		ID: uuid.New(), WarehouseID: warehouseID, ProductID: productID,
		MovementType: CourierMovementType(movementType), Quantity: abs(qtyDelta),
		PreviousQuantity: ci.Quantity, NewQuantity: newQty,
		ReferenceType: &refType, ReferenceID: &referenceID, Reason: &rsn, CreatedBy: actorID,
	}
	if qtyDelta == 0 {
		mv.Quantity = abs(reservedDelta)
	}
	return s.repo.InsertCourierMovement(tx, ctx, mv)
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// ─── Warehouses ───────────────────────────────────────────────────────────────

func (s *Service) ListWarehouses(ctx context.Context, typeFilter string) ([]WarehouseResponse, error) {
	rows, err := s.repo.ListWarehouses(ctx, typeFilter)
	if err != nil {
		return nil, err
	}
	out := make([]WarehouseResponse, 0, len(rows))
	for i := range rows {
		out = append(out, ToWarehouseResponse(&rows[i]))
	}
	return out, nil
}

func (s *Service) GetInventorySummary(ctx context.Context) (*InventorySummary, error) {
	return s.repo.GetInventorySummary(ctx)
}

func (s *Service) GetInventoryDistribution(ctx context.Context) (*InventoryDistributionResponse, error) {
	return s.repo.GetInventoryDistribution(ctx)
}

func (s *Service) ListCouriers(ctx context.Context) ([]CourierBrief, error) {
	return s.repo.ListCouriers(ctx)
}

func (s *Service) CreateWarehouse(ctx context.Context, actorID uuid.UUID, req CreateWarehouseRequest) (*WarehouseResponse, error) {
	w := &Warehouse{ID: uuid.New(), Type: WarehouseTypeMain, Name: req.Name, CityID: req.CityID, IsActive: true}
	if err := s.repo.CreateWarehouse(ctx, w); err != nil {
		return nil, err
	}
	s.logger.LogAsync(activity.Entry{
		ActorID: &actorID, Action: "create_warehouse", EntityType: "warehouse", EntityID: &w.ID,
		AfterState: map[string]interface{}{"name": w.Name},
	})
	resp := ToWarehouseResponse(w)
	return &resp, nil
}

// ─── Transfers (main warehouse -> courier issuance) ────────────────────────────

func (s *Service) CreateTransfer(ctx context.Context, actorID uuid.UUID, req CreateTransferRequest) (*TransferResponse, error) {
	courier, err := s.userRepo.GetByID(ctx, req.CourierID)
	if err != nil {
		return nil, err
	}
	if courier == nil || courier.Role != users.RoleCourier {
		return nil, apperrors.BadRequest("выбранный пользователь не является курьером")
	}
	from, err := s.repo.GetWarehouse(ctx, req.FromWarehouseID)
	if err != nil {
		return nil, err
	}
	if from == nil || from.Type != WarehouseTypeMain {
		return nil, apperrors.BadRequest("склад-источник должен быть активным главным складом")
	}

	transfer := &InventoryTransfer{
		ID: uuid.New(), FromWarehouseID: req.FromWarehouseID, ToCourierID: req.CourierID,
		Status: TransferIssued, CreatedBy: actorID,
	}
	items := make([]InventoryTransferItem, 0, len(req.Items))
	for _, it := range req.Items {
		if it.Quantity <= 0 {
			return nil, apperrors.BadRequest("количество должно быть больше 0")
		}
		items = append(items, InventoryTransferItem{ID: uuid.New(), ProductID: it.ProductID, Quantity: it.Quantity})
	}
	if len(items) == 0 {
		return nil, apperrors.BadRequest("передача должна содержать хотя бы один товар")
	}

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, it := range items {
			inv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, it.ProductID)
			if err != nil {
				return err
			}
			if inv.AvailableQuantity < it.Quantity {
				p, _ := s.prodRepo.GetProductByID(ctx, it.ProductID)
				name := it.ProductID.String()
				if p != nil {
					name = p.Name
				}
				return apperrors.BadRequest(fmt.Sprintf("недостаточно товара на складе-источнике: %s — доступно %d, требуется %d", name, inv.AvailableQuantity, it.Quantity))
			}
			if err := s.invRepo.UpdateBlockedQuantity(tx, ctx, inv.ID, inv.BlockedQuantity+it.Quantity); err != nil {
				return err
			}
		}
		return s.repo.CreateTransfer(tx, ctx, transfer, items)
	})
	if txErr != nil {
		return nil, txErr
	}

	s.logger.LogAsync(activity.Entry{
		ActorID: &actorID, Action: "create_transfer", EntityType: "inventory_transfer", EntityID: &transfer.ID,
		AfterState: map[string]interface{}{"courier_id": req.CourierID, "item_count": len(items)},
	})

	return s.GetTransfer(ctx, transfer.ID)
}

func (s *Service) GetTransfer(ctx context.Context, id uuid.UUID) (*TransferResponse, error) {
	var t InventoryTransfer
	if err := s.db.WithContext(ctx).Where("id = ?", id).First(&t).Error; err != nil {
		return nil, apperrors.NotFound("transfer")
	}
	var items []InventoryTransferItem
	if err := s.db.WithContext(ctx).Where("transfer_id = ?", id).Find(&items).Error; err != nil {
		return nil, err
	}
	t.Items = items
	return s.toTransferResponse(ctx, &t)
}

func (s *Service) toTransferResponse(ctx context.Context, t *InventoryTransfer) (*TransferResponse, error) {
	resp := &TransferResponse{
		ID: t.ID, FromWarehouseID: t.FromWarehouseID, ToCourierID: t.ToCourierID,
		ToWarehouseID: t.ToWarehouseID, Status: t.Status, CreatedBy: t.CreatedBy,
		CreatedAt: t.CreatedAt, DecidedBy: t.DecidedBy, DecidedAt: t.DecidedAt,
	}
	if from, _ := s.repo.GetWarehouse(ctx, t.FromWarehouseID); from != nil {
		resp.FromWarehouseName = from.Name
	}
	if courier, _ := s.userRepo.GetByID(ctx, t.ToCourierID); courier != nil {
		resp.CourierName = courier.FullName
	}
	if creator, _ := s.userRepo.GetByID(ctx, t.CreatedBy); creator != nil {
		resp.CreatedByName = creator.FullName
	}
	for _, it := range t.Items {
		row := TransferItemResponse{ProductID: it.ProductID, Quantity: it.Quantity}
		if p, _ := s.prodRepo.GetProductByID(ctx, it.ProductID); p != nil {
			row.ProductName = p.Name
			if len(p.Images) > 0 {
				row.ProductImageURL = &p.Images[0].ImageURL
			}
		}
		resp.Items = append(resp.Items, row)
	}
	return resp, nil
}

func (s *Service) ListTransfers(ctx context.Context, f ListTransfersFilter, courierID *uuid.UUID, p pagination.Params) ([]TransferResponse, int, error) {
	rows, total, err := s.repo.ListTransfers(ctx, f.Status, courierID, p)
	if err != nil {
		return nil, 0, err
	}
	out := make([]TransferResponse, 0, len(rows))
	for i := range rows {
		resp, err := s.toTransferResponse(ctx, &rows[i].InventoryTransfer)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *resp)
	}
	return out, total, nil
}

// AcceptTransfer: courier accepts the ENTIRE transfer. Moves stock from the
// legacy main pool to the courier's warehouse (consuming FIFO batches on the
// main side so COGS is recognized when goods leave the warehouse), and moves
// as much of the courier's existing active order reservations for each
// product as fits within the transferred quantity — the rest becomes free
// stock usable for any future order (spec section 3/4).
func (s *Service) AcceptTransfer(ctx context.Context, courierID uuid.UUID, transferID uuid.UUID) (*TransferResponse, error) {
	return s.decideTransfer(ctx, courierID, transferID, true)
}

func (s *Service) RejectTransfer(ctx context.Context, courierID uuid.UUID, transferID uuid.UUID) (*TransferResponse, error) {
	return s.decideTransfer(ctx, courierID, transferID, false)
}

func (s *Service) decideTransfer(ctx context.Context, courierID, transferID uuid.UUID, accept bool) (*TransferResponse, error) {
	courier, err := s.userRepo.GetByID(ctx, courierID)
	if err != nil {
		return nil, err
	}

	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		t, err := s.repo.GetTransferForUpdate(tx, ctx, transferID)
		if err != nil {
			return err
		}
		if t == nil {
			return apperrors.NotFound("transfer")
		}
		if t.ToCourierID != courierID {
			return apperrors.Forbidden("эта передача адресована не вам")
		}
		if t.Status != TransferIssued {
			return apperrors.Conflict("решение по этой передаче уже принято")
		}

		if !accept {
			for _, it := range t.Items {
				inv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, it.ProductID)
				if err != nil {
					return err
				}
				newBlocked := inv.BlockedQuantity - it.Quantity
				if newBlocked < 0 {
					newBlocked = 0
				}
				if err := s.invRepo.UpdateBlockedQuantity(tx, ctx, inv.ID, newBlocked); err != nil {
					return err
				}
			}
			return s.repo.UpdateTransferStatus(tx, ctx, t.ID, TransferRejected, nil, courierID)
		}

		courierWh, err := s.repo.GetOrCreateCourierWarehouseForUpdate(tx, ctx, courierID, courierNameOr(courier, courierID))
		if err != nil {
			return err
		}

		for _, it := range t.Items {
			// Release the block and remove stock from the main pool.
			inv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, it.ProductID)
			if err != nil {
				return err
			}
			newBlocked := inv.BlockedQuantity - it.Quantity
			if newBlocked < 0 {
				newBlocked = 0
			}
			if err := s.invRepo.UpdateBlockedQuantity(tx, ctx, inv.ID, newBlocked); err != nil {
				return err
			}
			prevQty := inv.Quantity
			newQty := prevQty - it.Quantity
			if newQty < 0 {
				return apperrors.BadRequest("недостаточно товара на складе-источнике для завершения передачи")
			}
			if err := s.invRepo.UpdateQuantity(tx, ctx, inv.ID, newQty); err != nil {
				return err
			}
			mv := &inventory.Movement{
				ID: uuid.New(), ProductID: it.ProductID, MovementType: inventory.MovementTransferOut,
				Quantity: it.Quantity, PreviousQuantity: prevQty, NewQuantity: newQty,
				ReferenceID: &t.ID, CreatedBy: courierID,
			}
			reason := "courier transfer accepted: " + t.ID.String()
			mv.Reason = &reason
			if err := s.invRepo.InsertMovement(tx, ctx, mv); err != nil {
				return err
			}
			if _, err := s.invRepo.ConsumeFEFO(tx, ctx, it.ProductID, it.Quantity, mv.ID); err != nil {
				return err
			}

			// Add stock to the courier warehouse.
			ci, err := s.repo.GetOrCreateCourierInventoryForUpdate(tx, ctx, courierWh.ID, it.ProductID)
			if err != nil {
				return err
			}
			ciPrev := ci.Quantity
			ciNew := ciPrev + it.Quantity
			if err := s.repo.UpdateCourierInventory(tx, ctx, ci.ID, ciNew, ci.ReservedQuantity, ci.BlockedQuantity); err != nil {
				return err
			}
			refType := RefTypeTransfer
			cmv := &CourierInventoryMovement{
				ID: uuid.New(), WarehouseID: courierWh.ID, ProductID: it.ProductID,
				MovementType: CourierMovementTransferIn, Quantity: it.Quantity,
				PreviousQuantity: ciPrev, NewQuantity: ciNew,
				ReferenceType: &refType, ReferenceID: &t.ID, CreatedBy: courierID,
			}
			if err := s.repo.InsertCourierMovement(tx, ctx, cmv); err != nil {
				return err
			}

			// Move as many of the courier's active order reservations for
			// this product from the main pool to the courier warehouse as
			// fit within the transferred quantity.
			remaining := it.Quantity
			reservedItems, err := s.ordersSvc.FindActiveReservationsForCourier(tx, ctx, it.ProductID, courierID)
			if err != nil {
				return err
			}
			for _, ri := range reservedItems {
				if remaining <= 0 {
					break
				}
				if ri.Quantity > remaining {
					continue // whole-item moves only; see design note in repository.go
				}
				remaining -= ri.Quantity

				mInv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, it.ProductID)
				if err != nil {
					return err
				}
				newMainReserved := mInv.ReservedQuantity - ri.Quantity
				if newMainReserved < 0 {
					newMainReserved = 0
				}
				if err := s.invRepo.UpdateReservedQuantity(tx, ctx, mInv.ID, newMainReserved); err != nil {
					return err
				}

				ci2, err := s.repo.GetOrCreateCourierInventoryForUpdate(tx, ctx, courierWh.ID, it.ProductID)
				if err != nil {
					return err
				}
				if err := s.repo.UpdateCourierInventory(tx, ctx, ci2.ID, ci2.Quantity, ci2.ReservedQuantity+ri.Quantity, ci2.BlockedQuantity); err != nil {
					return err
				}
				if err := s.ordersSvc.SetItemWarehouse(tx, ctx, ri.ID, courierWh.ID); err != nil {
					return err
				}
			}
		}

		return s.repo.UpdateTransferStatus(tx, ctx, t.ID, TransferAccepted, &courierWh.ID, courierID)
	})
	if txErr != nil {
		return nil, txErr
	}

	action := "reject_transfer"
	if accept {
		action = "accept_transfer"
	}
	s.logger.LogAsync(activity.Entry{ActorID: &courierID, Action: action, EntityType: "inventory_transfer", EntityID: &transferID})

	return s.GetTransfer(ctx, transferID)
}

func courierNameOr(u *users.User, id uuid.UUID) string {
	if u != nil {
		return u.FullName
	}
	return id.String()
}

// ─── Self-assignment stock check + reservation move ────────────────────────────

// ReserveForClaim verifies the courier's own warehouse holds enough stock for
// every item of orderID and, if so, moves the reservation there. Called by
// internal/courier.Service.ClaimOrder inside its own transaction — must run
// server-side, in a single transaction, per spec section 5.
func (s *Service) ReserveForClaim(tx *gorm.DB, ctx context.Context, courierID, orderID uuid.UUID) error {
	o, err := s.ordersSvc.LockOrderForWarehouseOp(tx, ctx, orderID)
	if err != nil {
		return err
	}

	courier, _ := s.userRepo.GetByID(ctx, courierID)
	courierWh, err := s.repo.GetOrCreateCourierWarehouseForUpdate(tx, ctx, courierID, courierNameOr(courier, courierID))
	if err != nil {
		return err
	}

	// First pass: verify every item has enough available stock. If this same
	// warehouse already backs the released order, its existing reservation
	// counts toward the claim and does not need to be reserved twice.
	for _, it := range o.Items {
		ci, err := s.repo.GetOrCreateCourierInventoryForUpdate(tx, ctx, courierWh.ID, it.ProductID)
		if err != nil {
			return err
		}
		available := ci.AvailableQuantity
		if it.ReservedWarehouseID == courierWh.ID {
			available += it.Quantity
		}
		if available < it.Quantity {
			name := it.ProductName
			if name == "" {
				name = it.ProductID.String()
			}
			return apperrors.BadRequest(fmt.Sprintf("Ваш склад не содержит достаточно товара: %s", name))
		}
	}

	// Second pass: atomically move the reservation from whichever warehouse
	// currently backs the order to the claiming courier's warehouse.
	for _, it := range o.Items {
		if it.ReservedWarehouseID == courierWh.ID {
			continue
		}

		ci, err := s.repo.GetOrCreateCourierInventoryForUpdate(tx, ctx, courierWh.ID, it.ProductID)
		if err != nil {
			return err
		}
		if err := s.repo.UpdateCourierInventory(tx, ctx, ci.ID, ci.Quantity, ci.ReservedQuantity+it.Quantity, ci.BlockedQuantity); err != nil {
			return err
		}
		refType := RefTypeOrder
		mv := &CourierInventoryMovement{
			ID: uuid.New(), WarehouseID: courierWh.ID, ProductID: it.ProductID,
			MovementType: CourierMovementClaimReserve, Quantity: it.Quantity,
			PreviousQuantity: ci.Quantity, NewQuantity: ci.Quantity,
			ReferenceType: &refType, ReferenceID: &orderID, CreatedBy: courierID,
		}
		if err := s.repo.InsertCourierMovement(tx, ctx, mv); err != nil {
			return err
		}

		if it.ReservedWarehouseID == orders.MainWarehouseID {
			mainInv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, it.ProductID)
			if err != nil {
				return err
			}
			newReserved := mainInv.ReservedQuantity - it.Quantity
			if newReserved < 0 {
				newReserved = 0
			}
			if err := s.invRepo.UpdateReservedQuantity(tx, ctx, mainInv.ID, newReserved); err != nil {
				return err
			}
		} else {
			if err := s.AdjustForOrder(
				ctx, tx, it.ReservedWarehouseID, it.ProductID,
				0, -it.Quantity, string(CourierMovementClaimRelease),
				orderID, courierID, "reservation moved to another courier",
			); err != nil {
				return err
			}
		}
		if err := s.ordersSvc.SetItemWarehouse(tx, ctx, it.ID, courierWh.ID); err != nil {
			return err
		}
	}
	return nil
}

// ─── My Warehouse ─────────────────────────────────────────────────────────────

func (s *Service) MyWarehouse(ctx context.Context, courierID uuid.UUID) (*MyWarehouseResponse, error) {
	resp := &MyWarehouseResponse{Items: []CourierStockItem{}, PendingTransfers: []TransferResponse{}}

	wh, err := s.repo.GetCourierWarehouse(ctx, courierID)
	if err != nil {
		return nil, err
	}
	if wh != nil {
		resp.WarehouseID = &wh.ID
		rows, err := s.repo.ListCourierInventory(ctx, wh.ID)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			item := CourierStockItem{
				ProductID: r.ProductID, Quantity: r.Quantity,
				ReservedQuantity: r.ReservedQuantity, AvailableQuantity: r.AvailableQuantity,
			}
			if p, _ := s.prodRepo.GetProductByID(ctx, r.ProductID); p != nil {
				item.ProductName = p.Name
				if len(p.Images) > 0 {
					item.ProductImageURL = &p.Images[0].ImageURL
				}
			}
			resp.Items = append(resp.Items, item)
		}
	}

	pending, _, err := s.repo.ListTransfers(ctx, string(TransferIssued), &courierID, pagination.Params{Limit: 50})
	if err != nil {
		return nil, err
	}
	for i := range pending {
		r, err := s.toTransferResponse(ctx, &pending[i].InventoryTransfer)
		if err != nil {
			return nil, err
		}
		resp.PendingTransfers = append(resp.PendingTransfers, *r)
	}
	return resp, nil
}

// ─── Returns (full inventory only) ────────────────────────────────────────────

// CreateFullReturn blocks the courier's entire current FREE balance (stock
// not tied to an active order reservation) and creates a return request.
// Partial returns are not supported — the courier never enters quantities.
func (s *Service) CreateFullReturn(ctx context.Context, courierID uuid.UUID, req CreateReturnRequest) (*ReturnResponse, error) {
	open, err := s.repo.HasOpenReturn(ctx, courierID)
	if err != nil {
		return nil, err
	}
	if open {
		return nil, apperrors.Conflict("у курьера уже есть возврат, ожидающий рассмотрения")
	}
	toWh, err := s.repo.GetWarehouse(ctx, req.ToWarehouseID)
	if err != nil {
		return nil, err
	}
	if toWh == nil || toWh.Type != WarehouseTypeMain {
		return nil, apperrors.BadRequest("склад назначения должен быть активным главным складом")
	}

	var ret *CourierReturn
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		courierWh, err := s.repo.GetOrCreateCourierWarehouseForUpdate(tx, ctx, courierID, courierID.String())
		if err != nil {
			return err
		}
		stock, err := s.repo.ListCourierInventory(ctx, courierWh.ID)
		if err != nil {
			return err
		}
		var items []CourierReturnItem
		for _, row := range stock {
			ci, err := s.repo.GetOrCreateCourierInventoryForUpdate(tx, ctx, courierWh.ID, row.ProductID)
			if err != nil {
				return err
			}
			if ci.AvailableQuantity <= 0 {
				continue
			}
			items = append(items, CourierReturnItem{ID: uuid.New(), ProductID: ci.ProductID, Quantity: ci.AvailableQuantity})
			if err := s.repo.UpdateCourierInventory(tx, ctx, ci.ID, ci.Quantity, ci.ReservedQuantity, ci.BlockedQuantity+ci.AvailableQuantity); err != nil {
				return err
			}
		}
		if len(items) == 0 {
			return apperrors.BadRequest("нет свободного товара для возврата")
		}
		ret = &CourierReturn{
			ID: uuid.New(), CourierID: courierID, FromWarehouseID: courierWh.ID,
			ToWarehouseID: req.ToWarehouseID, Status: ReturnRequested, CreatedBy: courierID,
		}
		return s.repo.CreateReturn(tx, ctx, ret, items)
	})
	if txErr != nil {
		return nil, txErr
	}
	s.logger.LogAsync(activity.Entry{ActorID: &courierID, Action: "create_return", EntityType: "courier_return", EntityID: &ret.ID})
	return s.getReturnResponse(ctx, ret.ID)
}

func (s *Service) ListReturns(ctx context.Context, status string, p pagination.Params) ([]ReturnResponse, int, error) {
	rows, total, err := s.repo.ListReturns(ctx, status, p)
	if err != nil {
		return nil, 0, err
	}
	out := make([]ReturnResponse, 0, len(rows))
	for i := range rows {
		r := rows[i]
		resp := ReturnResponse{
			ID: r.ID, CourierID: r.CourierID, CourierName: r.CourierName,
			FromWarehouseID: r.FromWarehouseID, ToWarehouseID: r.ToWarehouseID,
			Status: r.Status, CreatedAt: r.CreatedAt, DecidedBy: r.DecidedBy, DecidedAt: r.DecidedAt,
		}
		for _, it := range r.Items {
			row := ReturnItemResponse{ProductID: it.ProductID, Quantity: it.Quantity}
			if p, _ := s.prodRepo.GetProductByID(ctx, it.ProductID); p != nil {
				row.ProductName = p.Name
			}
			resp.Items = append(resp.Items, row)
		}
		out = append(out, resp)
	}
	return out, total, nil
}

func (s *Service) getReturnResponse(ctx context.Context, id uuid.UUID) (*ReturnResponse, error) {
	var ret CourierReturn
	if err := s.db.WithContext(ctx).Where("id = ?", id).First(&ret).Error; err != nil {
		return nil, apperrors.NotFound("return")
	}
	var items []CourierReturnItem
	if err := s.db.WithContext(ctx).Where("return_id = ?", id).Find(&items).Error; err != nil {
		return nil, err
	}
	resp := &ReturnResponse{
		ID: ret.ID, CourierID: ret.CourierID, FromWarehouseID: ret.FromWarehouseID,
		ToWarehouseID: ret.ToWarehouseID, Status: ret.Status, CreatedAt: ret.CreatedAt,
		DecidedBy: ret.DecidedBy, DecidedAt: ret.DecidedAt,
	}
	if courier, _ := s.userRepo.GetByID(ctx, ret.CourierID); courier != nil {
		resp.CourierName = courier.FullName
	}
	for _, it := range items {
		row := ReturnItemResponse{ProductID: it.ProductID, Quantity: it.Quantity}
		if p, _ := s.prodRepo.GetProductByID(ctx, it.ProductID); p != nil {
			row.ProductName = p.Name
		}
		resp.Items = append(resp.Items, row)
	}
	return resp, nil
}

// AcceptReturn moves the blocked stock from the courier warehouse into the
// chosen main warehouse. Only after this does the main-warehouse balance
// increase — the courier's blocked stock is never simultaneously available
// in both places.
func (s *Service) AcceptReturn(ctx context.Context, actorID uuid.UUID, returnID uuid.UUID) (*ReturnResponse, error) {
	return s.decideReturn(ctx, actorID, returnID, true)
}

func (s *Service) RejectReturn(ctx context.Context, actorID uuid.UUID, returnID uuid.UUID) (*ReturnResponse, error) {
	return s.decideReturn(ctx, actorID, returnID, false)
}

func (s *Service) decideReturn(ctx context.Context, actorID, returnID uuid.UUID, accept bool) (*ReturnResponse, error) {
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		ret, err := s.repo.GetReturnForUpdate(tx, ctx, returnID)
		if err != nil {
			return err
		}
		if ret == nil {
			return apperrors.NotFound("return")
		}
		if ret.Status != ReturnRequested {
			return apperrors.Conflict("решение по этому возврату уже принято")
		}

		for _, it := range ret.Items {
			ci, err := s.repo.GetOrCreateCourierInventoryForUpdate(tx, ctx, ret.FromWarehouseID, it.ProductID)
			if err != nil {
				return err
			}
			newBlocked := ci.BlockedQuantity - it.Quantity
			if newBlocked < 0 {
				newBlocked = 0
			}
			if !accept {
				if err := s.repo.UpdateCourierInventory(tx, ctx, ci.ID, ci.Quantity, ci.ReservedQuantity, newBlocked); err != nil {
					return err
				}
				continue
			}

			newQty := ci.Quantity - it.Quantity
			if newQty < 0 {
				return apperrors.BadRequest("ошибка склада курьера при приёме возврата")
			}
			if err := s.repo.UpdateCourierInventory(tx, ctx, ci.ID, newQty, ci.ReservedQuantity, newBlocked); err != nil {
				return err
			}
			refType := RefTypeReturn
			cmv := &CourierInventoryMovement{
				ID: uuid.New(), WarehouseID: ret.FromWarehouseID, ProductID: it.ProductID,
				MovementType: CourierMovementTransferOut, Quantity: it.Quantity,
				PreviousQuantity: ci.Quantity, NewQuantity: newQty,
				ReferenceType: &refType, ReferenceID: &ret.ID, CreatedBy: actorID,
			}
			if err := s.repo.InsertCourierMovement(tx, ctx, cmv); err != nil {
				return err
			}

			mainInv, err := s.invRepo.GetOrCreateForUpdate(tx, ctx, it.ProductID)
			if err != nil {
				return err
			}
			mainPrev := mainInv.Quantity
			mainNew := mainPrev + it.Quantity
			if err := s.invRepo.UpdateQuantity(tx, ctx, mainInv.ID, mainNew); err != nil {
				return err
			}
			mv := &inventory.Movement{
				ID: uuid.New(), ProductID: it.ProductID, MovementType: inventory.MovementTransferIn,
				Quantity: it.Quantity, PreviousQuantity: mainPrev, NewQuantity: mainNew,
				ReferenceID: &ret.ID, CreatedBy: actorID,
			}
			reason := "courier return accepted: " + ret.ID.String()
			mv.Reason = &reason
			if err := s.invRepo.InsertMovement(tx, ctx, mv); err != nil {
				return err
			}
			// Cost basis for the returned lot: current product purchase
			// price (tracing the exact original FIFO batch(es) a mixed
			// courier balance drew from is not attempted — documented
			// simplification).
			unitCost := 0.0
			if p, _ := s.prodRepo.GetProductByID(ctx, it.ProductID); p != nil && p.PurchasePrice != nil {
				unitCost = *p.PurchasePrice
			}
			batch := &inventory.Batch{
				ID: uuid.New(), ProductID: it.ProductID, ReceivedQuantity: it.Quantity,
				RemainingQuantity: it.Quantity, UnitCost: unitCost, ReceivedAt: time.Now().UTC(),
				MovementID: &mv.ID, CreatedBy: &actorID,
			}
			if err := s.invRepo.CreateBatch(tx, ctx, batch); err != nil {
				return err
			}
		}

		if accept {
			return s.repo.UpdateReturnStatus(tx, ctx, ret.ID, ReturnAccepted, actorID)
		}
		return s.repo.UpdateReturnStatus(tx, ctx, ret.ID, ReturnRejected, actorID)
	})
	if txErr != nil {
		return nil, txErr
	}
	action := "reject_return"
	if accept {
		action = "accept_return"
	}
	s.logger.LogAsync(activity.Entry{ActorID: &actorID, Action: action, EntityType: "courier_return", EntityID: &returnID})
	return s.getReturnResponse(ctx, returnID)
}

// ─── Lost product reports ─────────────────────────────────────────────────────

func (s *Service) CreateLostReport(ctx context.Context, courierID uuid.UUID, req CreateLostReportRequest) (*LostReportResponse, error) {
	wh, err := s.repo.GetCourierWarehouse(ctx, courierID)
	if err != nil {
		return nil, err
	}
	if wh == nil {
		return nil, apperrors.BadRequest("у курьера нет склада")
	}
	product, err := s.prodRepo.GetProductByID(ctx, req.ProductID)
	if err != nil || product == nil {
		return nil, apperrors.NotFound("product")
	}
	unitCost := 0.0
	if product.PurchasePrice != nil {
		unitCost = *product.PurchasePrice
	}

	var rep *LostProductReport
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		ci, err := s.repo.GetOrCreateCourierInventoryForUpdate(tx, ctx, wh.ID, req.ProductID)
		if err != nil {
			return err
		}
		if ci.AvailableQuantity < req.Quantity {
			return apperrors.BadRequest("недостаточно свободного товара, чтобы заявить об утере")
		}
		rep = &LostProductReport{
			ID: uuid.New(), CourierID: courierID, WarehouseID: wh.ID, ProductID: req.ProductID,
			Quantity: req.Quantity, PhotoURL: req.PhotoURL, Comment: req.Comment,
			UnitCost: unitCost, DebtAmount: unitCost * float64(req.Quantity),
			Status: LostReportPending, CreatedBy: courierID,
		}
		// Block the reported quantity so it can't be double-counted (e.g.
		// claimed against a new order) while the report is pending.
		if err := s.repo.UpdateCourierInventory(tx, ctx, ci.ID, ci.Quantity, ci.ReservedQuantity, ci.BlockedQuantity+req.Quantity); err != nil {
			return err
		}
		return s.repo.CreateLostReport(ctx, rep)
	})
	if txErr != nil {
		return nil, txErr
	}
	s.logger.LogAsync(activity.Entry{
		ActorID: &courierID, Action: "create_lost_report", EntityType: "lost_product_report", EntityID: &rep.ID,
		AfterState: map[string]interface{}{"product_id": req.ProductID, "quantity": req.Quantity},
	})
	resp := ToLostReportResponse(rep, true)
	return &resp, nil
}

// DecideLostReport approves or rejects a pending lost-product report.
// Approval deducts the stock (releasing the block) and finalizes the debt;
// rejection just releases the block. Only an owner/warehouse_manager may
// call this (route-gated) — the courier app never creates the debt itself.
func (s *Service) DecideLostReport(ctx context.Context, actorID uuid.UUID, reportID uuid.UUID, req DecideLostReportRequest) (*LostReportResponse, error) {
	var rep *LostProductReport
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		r, err := s.repo.GetLostReportForUpdate(tx, ctx, reportID)
		if err != nil {
			return err
		}
		if r == nil {
			return apperrors.NotFound("lost report")
		}
		if r.Status != LostReportPending {
			return apperrors.Conflict("решение по этой заявке уже принято")
		}
		rep = r

		ci, err := s.repo.GetOrCreateCourierInventoryForUpdate(tx, ctx, r.WarehouseID, r.ProductID)
		if err != nil {
			return err
		}
		newBlocked := ci.BlockedQuantity - r.Quantity
		if newBlocked < 0 {
			newBlocked = 0
		}

		if !req.Approve {
			if err := s.repo.UpdateCourierInventory(tx, ctx, ci.ID, ci.Quantity, ci.ReservedQuantity, newBlocked); err != nil {
				return err
			}
			if err := s.repo.UpdateLostReportStatus(tx, ctx, r.ID, LostReportRejected, actorID); err != nil {
				return err
			}
			rep.Status = LostReportRejected
			return nil
		}

		newQty := ci.Quantity - r.Quantity
		if newQty < 0 {
			return apperrors.BadRequest("ошибка склада курьера при утверждении заявки")
		}
		if err := s.repo.UpdateCourierInventory(tx, ctx, ci.ID, newQty, ci.ReservedQuantity, newBlocked); err != nil {
			return err
		}
		refType := RefTypeLostReport
		mv := &CourierInventoryMovement{
			ID: uuid.New(), WarehouseID: r.WarehouseID, ProductID: r.ProductID,
			MovementType: CourierMovementLost, Quantity: r.Quantity,
			PreviousQuantity: ci.Quantity, NewQuantity: newQty,
			ReferenceType: &refType, ReferenceID: &r.ID, CreatedBy: actorID,
		}
		if err := s.repo.InsertCourierMovement(tx, ctx, mv); err != nil {
			return err
		}
		if err := s.repo.UpdateLostReportStatus(tx, ctx, r.ID, LostReportApproved, actorID); err != nil {
			return err
		}
		rep.Status = LostReportApproved
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	s.logger.LogAsync(activity.Entry{
		ActorID: &actorID, Action: "decide_lost_report", EntityType: "lost_product_report", EntityID: &reportID,
		AfterState: map[string]interface{}{"approved": req.Approve, "debt_amount": rep.DebtAmount},
	})
	resp := ToLostReportResponse(rep, true)
	return &resp, nil
}

func (s *Service) ListLostReports(ctx context.Context, status string, courierID *uuid.UUID, p pagination.Params) ([]LostReportResponse, int, error) {
	rows, total, err := s.repo.ListLostReports(ctx, status, courierID, p)
	if err != nil {
		return nil, 0, err
	}
	out := make([]LostReportResponse, 0, len(rows))
	for i := range rows {
		out = append(out, ToLostReportResponse(&rows[i], true))
	}
	return out, total, nil
}
