package pharmacies

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/megamall/crm/internal/compensation"
	"github.com/megamall/crm/internal/inventory"
	"github.com/megamall/crm/internal/products"
	apperrors "github.com/megamall/crm/pkg/errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Service struct {
	repo      *Repository
	inventory *inventory.Service
	comp      *compensation.Service
}

func NewService(repo *Repository, inventorySvc *inventory.Service, comp *compensation.Service) *Service {
	return &Service{repo: repo, inventory: inventorySvc, comp: comp}
}

func money(v float64) float64 { return math.Round(v*100) / 100 }

func documentNumber(prefix string, id uuid.UUID) string {
	return fmt.Sprintf("%s-%s-%s", prefix, time.Now().Format("20060102"), strings.ToUpper(strings.ReplaceAll(id.String(), "-", "")[:8]))
}

func event(tx *gorm.DB, pharmacyID, entityID, actorID uuid.UUID, entityType, eventType string, metadata interface{}) error {
	b, _ := json.Marshal(metadata)
	return tx.Exec(`
		INSERT INTO pharmacy_events(id,pharmacy_id,entity_type,entity_id,event_type,actor_id,metadata)
		VALUES (?,?,?,?,?,?,?::jsonb)
	`, uuid.New(), pharmacyID, entityType, entityID, eventType, actorID, string(b)).Error
}

func (s *Service) ensureSeller(ctx context.Context, tx *gorm.DB, id uuid.UUID) error {
	var count int64
	if err := tx.WithContext(ctx).Table("users").
		Where("id=? AND role='seller' AND is_active=TRUE AND deleted_at IS NULL", id).
		Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return apperrors.BadRequest("responsible seller is not active")
	}
	return nil
}

func (s *Service) getPharmacy(ctx context.Context, tx *gorm.DB, actor Actor, id uuid.UUID, lock bool) (*Pharmacy, error) {
	q := tx.WithContext(ctx)
	if lock {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var p Pharmacy
	if err := q.Where("id=?", id).First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperrors.NotFound("pharmacy")
		}
		return nil, err
	}
	if actor.Role == "seller" && p.ResponsibleSellerID != actor.ID {
		return nil, apperrors.Forbidden("pharmacy is assigned to another seller")
	}
	return &p, nil
}

func (s *Service) List(ctx context.Context, actor Actor, includeArchived bool) ([]PharmacyListRow, error) {
	return s.repo.List(ctx, actor, includeArchived)
}

func (s *Service) Dashboard(ctx context.Context, actor Actor, from, to time.Time) (Dashboard, error) {
	return s.repo.Dashboard(ctx, actor, from, to)
}

func (s *Service) Detail(ctx context.Context, actor Actor, id uuid.UUID) (*DetailResponse, error) {
	out, err := s.repo.Detail(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, apperrors.NotFound("pharmacy")
	}
	return out, nil
}

func (s *Service) Create(ctx context.Context, actor Actor, req CreatePharmacyRequest) (*Pharmacy, error) {
	if actor.Role != "owner" && actor.Role != "warehouse_manager" {
		return nil, apperrors.Forbidden("only owner or warehouse manager can create a pharmacy")
	}
	p := &Pharmacy{
		ID: uuid.New(), Name: strings.TrimSpace(req.Name), Address: strings.TrimSpace(req.Address),
		OwnerName: strings.TrimSpace(req.OwnerName), OwnerPhone: strings.TrimSpace(req.OwnerPhone),
		ContactDetails: req.ContactDetails, Comment: req.Comment,
		ResponsibleSellerID: req.ResponsibleSellerID, CreatedBy: actor.ID,
	}
	err := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.ensureSeller(ctx, tx, req.ResponsibleSellerID); err != nil {
			return err
		}
		if err := tx.Create(p).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO pharmacy_responsibility_history
				(id,pharmacy_id,new_seller_id,changed_by,comment)
			VALUES (?,?,?,?,?)
		`, uuid.New(), p.ID, p.ResponsibleSellerID, actor.ID, "Initial assignment").Error; err != nil {
			return err
		}
		return event(tx, p.ID, p.ID, actor.ID, "pharmacy", "pharmacy_created", req)
	})
	return p, err
}

func (s *Service) Update(ctx context.Context, actor Actor, id uuid.UUID, req UpdatePharmacyRequest) (*Pharmacy, error) {
	if actor.Role != "owner" && actor.Role != "warehouse_manager" {
		return nil, apperrors.Forbidden("only owner or warehouse manager can edit a pharmacy")
	}
	var p *Pharmacy
	err := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		p, err = s.getPharmacy(ctx, tx, actor, id, true)
		if err != nil {
			return err
		}
		before := *p
		p.Name, p.Address = strings.TrimSpace(req.Name), strings.TrimSpace(req.Address)
		p.OwnerName, p.OwnerPhone = strings.TrimSpace(req.OwnerName), strings.TrimSpace(req.OwnerPhone)
		p.ContactDetails, p.Comment = req.ContactDetails, req.Comment
		if err := tx.Save(p).Error; err != nil {
			return err
		}
		return event(tx, p.ID, p.ID, actor.ID, "pharmacy", "pharmacy_updated", map[string]interface{}{"before": before, "after": p})
	})
	return p, err
}

func (s *Service) TransferResponsibility(ctx context.Context, actor Actor, id uuid.UUID, req TransferResponsibilityRequest) error {
	if actor.Role != "owner" && actor.Role != "warehouse_manager" {
		return apperrors.Forbidden("only owner or warehouse manager can transfer responsibility")
	}
	return s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := s.getPharmacy(ctx, tx, actor, id, true)
		if err != nil {
			return err
		}
		if p.ResponsibleSellerID == req.SellerID {
			return apperrors.BadRequest("seller is already responsible")
		}
		if err := s.ensureSeller(ctx, tx, req.SellerID); err != nil {
			return err
		}
		old := p.ResponsibleSellerID
		if err := tx.Model(p).Updates(map[string]interface{}{"responsible_seller_id": req.SellerID, "updated_at": time.Now()}).Error; err != nil {
			return err
		}
		// An undecided handover follows the pharmacy's new responsible seller.
		// Accepted documents keep their historical seller; future payments use
		// the pharmacy's current seller at confirmation time.
		if err := tx.Model(&Invoice{}).
			Where("pharmacy_id=? AND status='issued'", p.ID).
			Update("responsible_seller_id", req.SellerID).Error; err != nil {
			return err
		}
		if err := tx.Exec(`
			INSERT INTO pharmacy_responsibility_history
				(id,pharmacy_id,previous_seller_id,new_seller_id,changed_by,comment)
			VALUES (?,?,?,?,?,?)
		`, uuid.New(), p.ID, old, req.SellerID, actor.ID, req.Comment).Error; err != nil {
			return err
		}
		return event(tx, p.ID, p.ID, actor.ID, "pharmacy", "responsibility_transferred", map[string]interface{}{"from": old, "to": req.SellerID, "comment": req.Comment})
	})
}

func (s *Service) Archive(ctx context.Context, actor Actor, id uuid.UUID) error {
	if actor.Role != "owner" && actor.Role != "warehouse_manager" {
		return apperrors.Forbidden("only owner or warehouse manager can archive a pharmacy")
	}
	return s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := s.getPharmacy(ctx, tx, actor, id, true)
		if err != nil {
			return err
		}
		if p.ArchivedAt != nil {
			return nil
		}
		var stock int
		if err := tx.Raw("SELECT COALESCE(SUM(quantity),0) FROM pharmacy_stock WHERE pharmacy_id=?", id).Scan(&stock).Error; err != nil {
			return err
		}
		var debt float64
		if err := tx.Raw(`SELECT COALESCE(SUM(GREATEST(total_amount-paid_amount-returned_amount,0)),0)
			FROM pharmacy_invoices WHERE pharmacy_id=? AND status='accepted'`, id).Scan(&debt).Error; err != nil {
			return err
		}
		var credit float64
		if err := tx.Raw(`SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount ELSE -ABS(amount) END),0)
			FROM pharmacy_credit_ledger WHERE pharmacy_id=?`, id).Scan(&credit).Error; err != nil {
			return err
		}
		var openOperations int64
		if err := tx.Raw(`
			SELECT
				(SELECT COUNT(*) FROM pharmacy_invoices WHERE pharmacy_id=? AND status='issued')+
				(SELECT COUNT(*) FROM pharmacy_payments WHERE pharmacy_id=? AND status='pending')+
				(SELECT COUNT(*) FROM pharmacy_returns WHERE pharmacy_id=? AND status='requested')
		`, id, id, id).Scan(&openOperations).Error; err != nil {
			return err
		}
		if stock > 0 || debt > 0.009 || credit > 0.009 || openOperations > 0 {
			return apperrors.Conflict("pharmacy can be archived only with zero stock, debt, credit and no pending operations")
		}
		now := time.Now().UTC()
		if err := tx.Model(p).Updates(map[string]interface{}{"archived_at": now, "archived_by": actor.ID}).Error; err != nil {
			return err
		}
		return event(tx, id, id, actor.ID, "pharmacy", "pharmacy_archived", map[string]interface{}{})
	})
}

type hierarchyParticipants struct {
	TeamID     *uuid.UUID
	ManagerID  *uuid.UUID
	TeamLeadID *uuid.UUID
}

func (s *Service) hierarchy(ctx context.Context, tx *gorm.DB, sellerID uuid.UUID) (hierarchyParticipants, error) {
	var h hierarchyParticipants
	err := tx.WithContext(ctx).Raw(`
		SELECT uh.team_id,t.manager_id,t.team_lead_id
		FROM user_hierarchy uh LEFT JOIN teams t ON t.id=uh.team_id AND t.deleted_at IS NULL
		WHERE uh.user_id=?
	`, sellerID).Scan(&h).Error
	return h, err
}

func (s *Service) CreateInvoice(ctx context.Context, actor Actor, req CreateInvoiceRequest) (*Invoice, error) {
	if actor.Role != "owner" && actor.Role != "warehouse_manager" {
		return nil, apperrors.Forbidden("only owner or warehouse manager can issue goods")
	}
	invoiceID := uuid.New()
	inv := &Invoice{ID: invoiceID, InvoiceNumber: documentNumber("PHI", invoiceID), PharmacyID: req.PharmacyID, Status: "issued", Comment: req.Comment, CreatedBy: actor.ID}
	err := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := s.getPharmacy(ctx, tx, actor, req.PharmacyID, true)
		if err != nil {
			return err
		}
		if p.ArchivedAt != nil {
			return apperrors.Conflict("pharmacy is archived")
		}
		inv.ResponsibleSellerID = p.ResponsibleSellerID
		h, err := s.hierarchy(ctx, tx, p.ResponsibleSellerID)
		if err != nil {
			return err
		}
		inv.ManagerID, inv.TeamLeadID = h.ManagerID, h.TeamLeadID
		if err := tx.Create(inv).Error; err != nil {
			return err
		}

		seen := map[uuid.UUID]bool{}
		for _, input := range req.Items {
			if seen[input.ProductID] {
				return apperrors.BadRequest("duplicate product in invoice")
			}
			seen[input.ProductID] = true
			var product products.Product
			if err := tx.Where("id=? AND deleted_at IS NULL AND is_active=TRUE", input.ProductID).First(&product).Error; err != nil {
				return apperrors.BadRequest("product is not available")
			}
			price := 0.0
			if product.SalePrice != nil {
				price = *product.SalePrice
			}
			if input.UnitPrice != nil {
				price = *input.UnitPrice
			}
			net := money(price - input.DiscountAmount)
			if net < 0 {
				return apperrors.BadRequest("discount cannot exceed unit price")
			}
			reason := "Выдача аптеке · " + inv.InvoiceNumber
			unitCost, err := s.inventory.IssueExternalTx(ctx, tx, actor.ID, product.ID, inv.ID, input.Quantity, reason)
			if err != nil {
				return err
			}
			item := &InvoiceItem{
				ID: uuid.New(), InvoiceID: inv.ID, ProductID: product.ID, Quantity: input.Quantity,
				UnitPrice: money(price), DiscountAmount: money(input.DiscountAmount),
				NetUnitPrice: net, UnitCost: money(unitCost), LineTotal: money(net * float64(input.Quantity)),
			}
			inv.TotalAmount = money(inv.TotalAmount + item.LineTotal)
			if err := tx.Create(item).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(inv).Update("total_amount", inv.TotalAmount).Error; err != nil {
			return err
		}
		snap, err := s.comp.BuildRateSnapshot(ctx, compensation.SnapshotInput{
			SellerID: &p.ResponsibleSellerID, SellerTeamID: h.TeamID,
			ManagerID: h.ManagerID, ManagerTeamID: h.TeamID,
			TeamLeadID: h.TeamLeadID, TeamLeadTeamID: h.TeamID,
			ResolvedAt: time.Now().UTC(),
		})
		if err != nil {
			return err
		}
		ps := &FinancialSnapshot{
			ID: uuid.New(), InvoiceID: inv.ID, SellerRate: snap.SellerRate,
			ManagerTeamRate: snap.ManagerTeamRate, TeamLeadPoolRate: snap.TeamLeadPoolRate,
			CompanyRate: snap.CompanyRate, SellerConfigID: snap.SellerConfigID,
			ManagerConfigID: snap.ManagerTeamConfigID, TeamLeadConfigID: snap.TeamLeadPoolConfigID,
			CompanyConfigID: snap.CompanyConfigID, SnapshotJSON: snap.SnapshotJSON,
		}
		if err := tx.Create(ps).Error; err != nil {
			return err
		}
		return event(tx, p.ID, inv.ID, actor.ID, "invoice", "invoice_issued", map[string]interface{}{"number": inv.InvoiceNumber, "amount": inv.TotalAmount})
	})
	return inv, err
}

func (s *Service) DecideInvoice(ctx context.Context, actor Actor, id uuid.UUID, accept bool, reason string) error {
	if actor.Role != "seller" {
		return apperrors.Forbidden("only responsible seller can decide an invoice")
	}
	return s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var inv Invoice
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", id).First(&inv).Error; err != nil {
			return apperrors.NotFound("invoice")
		}
		if inv.ResponsibleSellerID != actor.ID {
			return apperrors.Forbidden("invoice is assigned to another seller")
		}
		if inv.Status != "issued" {
			return apperrors.Conflict("invoice has already been decided")
		}
		var items []InvoiceItem
		if err := tx.Where("invoice_id=?", inv.ID).Find(&items).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		if accept {
			for _, item := range items {
				if err := tx.Exec(`
					INSERT INTO pharmacy_stock(pharmacy_id,product_id,quantity)
					VALUES (?,?,?) ON CONFLICT(pharmacy_id,product_id)
					DO UPDATE SET quantity=pharmacy_stock.quantity+EXCLUDED.quantity,updated_at=NOW()
				`, inv.PharmacyID, item.ProductID, item.Quantity).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(&inv).Updates(map[string]interface{}{"status": "accepted", "accepted_at": now}).Error; err != nil {
				return err
			}
			if err := s.applyExistingCredit(ctx, tx, &inv, actor.ID); err != nil {
				return err
			}
			return event(tx, inv.PharmacyID, inv.ID, actor.ID, "invoice", "invoice_accepted", map[string]interface{}{"number": inv.InvoiceNumber})
		}
		if strings.TrimSpace(reason) == "" {
			return apperrors.BadRequest("rejection reason is required")
		}
		for _, item := range items {
			if err := s.inventory.ReturnExternalTx(ctx, tx, actor.ID, item.ProductID, inv.ID, item.Quantity, item.UnitCost, "Отклонена выдача аптеке · "+inv.InvoiceNumber); err != nil {
				return err
			}
		}
		if err := tx.Model(&inv).Updates(map[string]interface{}{"status": "rejected", "rejection_reason": reason, "rejected_at": now}).Error; err != nil {
			return err
		}
		return event(tx, inv.PharmacyID, inv.ID, actor.ID, "invoice", "invoice_rejected", map[string]interface{}{"reason": reason})
	})
}

func (s *Service) applyExistingCredit(ctx context.Context, tx *gorm.DB, inv *Invoice, actorID uuid.UUID) error {
	var credit float64
	if err := tx.Raw(`SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount ELSE -ABS(amount) END),0)
		FROM pharmacy_credit_ledger WHERE pharmacy_id=?`, inv.PharmacyID).Scan(&credit).Error; err != nil {
		return err
	}
	if credit <= 0 {
		return nil
	}
	apply := math.Min(credit, inv.TotalAmount-inv.PaidAmount-inv.ReturnedAmount)
	if apply <= 0 {
		return nil
	}
	if err := tx.Model(inv).UpdateColumn("paid_amount", gorm.Expr("paid_amount + ?", money(apply))).Error; err != nil {
		return err
	}
	return tx.Exec(`INSERT INTO pharmacy_credit_ledger(id,pharmacy_id,invoice_id,amount,entry_type,created_by)
		VALUES (?,?,?,?, 'applied',?)`, uuid.New(), inv.PharmacyID, inv.ID, money(apply), actorID).Error
}

func (s *Service) CreatePayment(ctx context.Context, actor Actor, req CreatePaymentRequest) (*Payment, error) {
	if actor.Role != "owner" && actor.Role != "seller" {
		return nil, apperrors.Forbidden("role cannot create pharmacy payments")
	}
	id := uuid.New()
	pay := &Payment{ID: id, PaymentNumber: documentNumber("PHP", id), PharmacyID: req.PharmacyID, Amount: money(req.Amount), Method: req.Method, Status: "pending", Comment: req.Comment, CreatedBy: actor.ID}
	err := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := s.getPharmacy(ctx, tx, actor, req.PharmacyID, true)
		if err != nil {
			return err
		}
		pay.ResponsibleSellerID = p.ResponsibleSellerID
		if err := tx.Create(pay).Error; err != nil {
			return err
		}
		if err := event(tx, p.ID, pay.ID, actor.ID, "payment", "payment_created", map[string]interface{}{"amount": pay.Amount, "method": pay.Method}); err != nil {
			return err
		}
		if actor.Role == "owner" {
			return s.confirmPaymentTx(ctx, tx, actor, pay)
		}
		return nil
	})
	return pay, err
}

func (s *Service) ConfirmPayment(ctx context.Context, actor Actor, id uuid.UUID) error {
	if actor.Role != "owner" {
		return apperrors.Forbidden("only owner can confirm a payment")
	}
	return s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var pay Payment
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", id).First(&pay).Error; err != nil {
			return apperrors.NotFound("payment")
		}
		return s.confirmPaymentTx(ctx, tx, actor, &pay)
	})
}

func (s *Service) confirmPaymentTx(ctx context.Context, tx *gorm.DB, actor Actor, pay *Payment) error {
	if pay.Status != "pending" {
		return apperrors.Conflict("payment is not pending")
	}
	var pharmacy Pharmacy
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", pay.PharmacyID).First(&pharmacy).Error; err != nil {
		return apperrors.NotFound("pharmacy")
	}
	// Responsibility at confirmation controls future earnings. This is
	// deliberate: a pending seller-entered payment has not earned anything.
	pay.ResponsibleSellerID = pharmacy.ResponsibleSellerID
	if err := tx.Model(pay).UpdateColumn("responsible_seller_id", pay.ResponsibleSellerID).Error; err != nil {
		return err
	}
	remaining := pay.Amount
	var invoices []Invoice
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("pharmacy_id=? AND status='accepted' AND total_amount>paid_amount+returned_amount", pay.PharmacyID).
		Order("accepted_at ASC,id ASC").Find(&invoices).Error; err != nil {
		return err
	}
	h, err := s.hierarchy(ctx, tx, pay.ResponsibleSellerID)
	if err != nil {
		return err
	}
	var lastSnapshot *FinancialSnapshot
	for i := range invoices {
		if remaining <= 0.009 {
			break
		}
		balance := money(invoices[i].TotalAmount - invoices[i].PaidAmount - invoices[i].ReturnedAmount)
		if balance <= 0 {
			continue
		}
		allocated := money(math.Min(balance, remaining))
		if err := tx.Model(&invoices[i]).UpdateColumn("paid_amount", gorm.Expr("paid_amount + ?", allocated)).Error; err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO pharmacy_payment_allocations(id,payment_id,invoice_id,amount)
			VALUES (?,?,?,?)`, uuid.New(), pay.ID, invoices[i].ID, allocated).Error; err != nil {
			return err
		}
		var snap FinancialSnapshot
		if err := tx.Where("invoice_id=?", invoices[i].ID).First(&snap).Error; err != nil {
			return err
		}
		if err := s.emitPaymentFinance(tx, pay, &invoices[i], &snap, h, allocated); err != nil {
			return err
		}
		lastSnapshot = &snap
		remaining = money(remaining - allocated)
	}
	if remaining > 0.009 {
		if lastSnapshot == nil {
			var snap FinancialSnapshot
			if err := tx.Table("pharmacy_financial_snapshots s").
				Joins("JOIN pharmacy_invoices i ON i.id=s.invoice_id").
				Where("i.pharmacy_id=? AND i.status='accepted'", pay.PharmacyID).
				Order("i.accepted_at DESC").First(&snap).Error; err != nil {
				return apperrors.BadRequest("payment cannot be confirmed before the first accepted invoice")
			}
			lastSnapshot = &snap
		}
		if err := tx.Exec(`INSERT INTO pharmacy_payment_allocations(id,payment_id,amount,is_credit)
			VALUES (?,?,?,TRUE)`, uuid.New(), pay.ID, remaining).Error; err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO pharmacy_credit_ledger(id,pharmacy_id,payment_id,amount,entry_type,created_by)
			VALUES (?,?,?,?, 'credit',?)`, uuid.New(), pay.PharmacyID, pay.ID, remaining, actor.ID).Error; err != nil {
			return err
		}
		if err := s.emitPaymentFinance(tx, pay, nil, lastSnapshot, h, remaining); err != nil {
			return err
		}
	}
	now := time.Now().UTC()
	if err := tx.Model(pay).Updates(map[string]interface{}{"status": "confirmed", "confirmed_by": actor.ID, "confirmed_at": now}).Error; err != nil {
		return err
	}
	pay.Status, pay.ConfirmedBy, pay.ConfirmedAt = "confirmed", &actor.ID, &now
	return event(tx, pay.PharmacyID, pay.ID, actor.ID, "payment", "payment_confirmed", map[string]interface{}{"amount": pay.Amount})
}

func (s *Service) emitPaymentFinance(tx *gorm.DB, pay *Payment, inv *Invoice, snap *FinancialSnapshot, h hierarchyParticipants, base float64) error {
	breakdown, err := calculatePaymentCommissions(base, snap)
	if err != nil {
		return err
	}
	var invoiceID *uuid.UUID
	if inv != nil {
		invoiceID = &inv.ID
	}
	meta, _ := json.Marshal(map[string]interface{}{"commission_base": base, "seller_rate": snap.SellerRate, "manager_rate": snap.ManagerTeamRate, "team_lead_pool_rate": snap.TeamLeadPoolRate})
	rows := []struct {
		eventType string
		userID    *uuid.UUID
		amount    float64
	}{
		{"seller_commission_earned", &pay.ResponsibleSellerID, breakdown.Seller},
		{"manager_team_commission_earned", h.ManagerID, breakdown.Manager},
		{"team_lead_pool_earned", h.TeamLeadID, breakdown.TeamLead},
		{"company_revenue_earned", nil, breakdown.Company},
	}
	for _, row := range rows {
		if row.amount <= 0 {
			continue
		}
		if err := tx.Exec(`
			INSERT INTO pharmacy_financial_events
				(id,pharmacy_id,payment_id,invoice_id,event_type,user_id,seller_id,manager_id,team_lead_id,amount,metadata)
			VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb)
		`, uuid.New(), pay.PharmacyID, pay.ID, invoiceID, row.eventType, row.userID,
			pay.ResponsibleSellerID, h.ManagerID, h.TeamLeadID, row.amount, string(meta)).Error; err != nil {
			return err
		}
	}
	return nil
}

type paymentCommissionBreakdown struct {
	Seller   float64
	Manager  float64
	TeamLead float64
	Company  float64
}

func calculatePaymentCommissions(base float64, snap *FinancialSnapshot) (paymentCommissionBreakdown, error) {
	if base < 0 {
		return paymentCommissionBreakdown{}, apperrors.BadRequest("commission base cannot be negative")
	}
	seller := money(base * snap.SellerRate)
	manager := money(base * snap.ManagerTeamRate)
	grossPool := money(base * snap.TeamLeadPoolRate)
	teamLead := money(grossPool - seller - manager)
	if teamLead < 0 {
		return paymentCommissionBreakdown{}, apperrors.Internal(fmt.Errorf("pharmacy commission rates exceed team lead pool"))
	}
	return paymentCommissionBreakdown{
		Seller: seller, Manager: manager, TeamLead: teamLead, Company: money(base - grossPool),
	}, nil
}

func (s *Service) RejectPayment(ctx context.Context, actor Actor, id uuid.UUID, reason string) error {
	if actor.Role != "owner" {
		return apperrors.Forbidden("only owner can reject a payment")
	}
	if strings.TrimSpace(reason) == "" {
		return apperrors.BadRequest("rejection reason is required")
	}
	return s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var pay Payment
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", id).First(&pay).Error; err != nil {
			return apperrors.NotFound("payment")
		}
		if pay.Status != "pending" {
			return apperrors.Conflict("payment is not pending")
		}
		now := time.Now().UTC()
		if err := tx.Model(&pay).Updates(map[string]interface{}{"status": "rejected", "rejection_reason": reason, "rejected_by": actor.ID, "rejected_at": now}).Error; err != nil {
			return err
		}
		return event(tx, pay.PharmacyID, pay.ID, actor.ID, "payment", "payment_rejected", map[string]interface{}{"reason": reason})
	})
}

func (s *Service) CorrectPayment(ctx context.Context, actor Actor, id uuid.UUID, req CorrectPaymentRequest) error {
	if actor.Role != "owner" {
		return apperrors.Forbidden("only owner can correct a payment")
	}
	req.Amount = money(req.Amount)
	return s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var pay Payment
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", id).First(&pay).Error; err != nil {
			return apperrors.NotFound("payment")
		}
		if pay.Status != "pending" && pay.Status != "confirmed" {
			return apperrors.Conflict("only pending or confirmed payments can be corrected")
		}
		oldAmount, oldMethod, oldComment, oldStatus := pay.Amount, pay.Method, pay.Comment, pay.Status
		if err := tx.Exec(`
			INSERT INTO pharmacy_payment_edits
				(id,payment_id,edited_by,old_amount,new_amount,old_method,new_method,old_comment,new_comment)
			VALUES (?,?,?,?,?,?,?,?,?)
		`, uuid.New(), pay.ID, actor.ID, oldAmount, req.Amount, oldMethod, req.Method, oldComment, req.Comment).Error; err != nil {
			return err
		}

		if oldStatus == "confirmed" {
			type allocation struct {
				ID        uuid.UUID
				InvoiceID *uuid.UUID
				Amount    float64
				IsCredit  bool
			}
			var allocations []allocation
			if err := tx.Raw(`
				SELECT id,invoice_id,amount,is_credit FROM pharmacy_payment_allocations
				WHERE payment_id=? AND reversed_at IS NULL FOR UPDATE
			`, pay.ID).Scan(&allocations).Error; err != nil {
				return err
			}
			for _, allocation := range allocations {
				if allocation.IsCredit {
					var credit float64
					if err := tx.Raw(`SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount ELSE -ABS(amount) END),0)
						FROM pharmacy_credit_ledger WHERE pharmacy_id=?`, pay.PharmacyID).Scan(&credit).Error; err != nil {
						return err
					}
					if credit+0.009 < allocation.Amount {
						return apperrors.Conflict("payment credit has already been used and cannot be corrected")
					}
					if err := tx.Exec(`INSERT INTO pharmacy_credit_ledger
						(id,pharmacy_id,payment_id,amount,entry_type,created_by)
						VALUES (?,?,?,?, 'applied',?)`,
						uuid.New(), pay.PharmacyID, pay.ID, allocation.Amount, actor.ID).Error; err != nil {
						return err
					}
				} else if allocation.InvoiceID != nil {
					if err := tx.Model(&Invoice{}).Where("id=?", *allocation.InvoiceID).
						UpdateColumn("paid_amount", gorm.Expr("GREATEST(paid_amount-?,0)", allocation.Amount)).Error; err != nil {
						return err
					}
				}
			}
			if err := tx.Table("pharmacy_payment_allocations").
				Where("payment_id=? AND reversed_at IS NULL", pay.ID).
				Update("reversed_at", time.Now().UTC()).Error; err != nil {
				return err
			}

			type financeEvent struct {
				InvoiceID  *uuid.UUID
				EventType  string
				UserID     *uuid.UUID
				SellerID   uuid.UUID
				ManagerID  *uuid.UUID
				TeamLeadID *uuid.UUID
				Amount     float64
			}
			var financial []financeEvent
			if err := tx.Raw(`
				SELECT invoice_id,event_type,user_id,seller_id,manager_id,team_lead_id,amount
				FROM pharmacy_financial_events WHERE payment_id=?
			`, pay.ID).Scan(&financial).Error; err != nil {
				return err
			}
			reversalMeta, _ := json.Marshal(map[string]interface{}{"correction": true, "reverses_payment_amount": oldAmount})
			for _, row := range financial {
				if err := tx.Exec(`
					INSERT INTO pharmacy_financial_events
						(id,pharmacy_id,payment_id,invoice_id,event_type,user_id,seller_id,manager_id,team_lead_id,amount,metadata)
					VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb)
				`, uuid.New(), pay.PharmacyID, pay.ID, row.InvoiceID, row.EventType, row.UserID,
					row.SellerID, row.ManagerID, row.TeamLeadID, -row.Amount, string(reversalMeta)).Error; err != nil {
					return err
				}
			}
		}

		if err := tx.Model(&pay).Updates(map[string]interface{}{
			"amount": req.Amount, "method": req.Method, "comment": req.Comment,
			"status": "pending", "confirmed_by": nil, "confirmed_at": nil,
		}).Error; err != nil {
			return err
		}
		pay.Amount, pay.Method, pay.Comment, pay.Status = req.Amount, req.Method, req.Comment, "pending"
		pay.ConfirmedBy, pay.ConfirmedAt = nil, nil
		if oldStatus == "confirmed" {
			if err := s.confirmPaymentTx(ctx, tx, actor, &pay); err != nil {
				return err
			}
		}
		return event(tx, pay.PharmacyID, pay.ID, actor.ID, "payment", "payment_corrected", map[string]interface{}{
			"old_amount": oldAmount, "new_amount": req.Amount,
			"old_method": oldMethod, "new_method": req.Method,
		})
	})
}

func (s *Service) CreateReturn(ctx context.Context, actor Actor, req CreateReturnRequest) (*PharmacyReturn, error) {
	if actor.Role != "owner" && actor.Role != "seller" {
		return nil, apperrors.Forbidden("role cannot create pharmacy returns")
	}
	id := uuid.New()
	ret := &PharmacyReturn{ID: id, ReturnNumber: documentNumber("PHR", id), PharmacyID: req.PharmacyID, Status: "requested", Reason: strings.TrimSpace(req.Reason), CreatedBy: actor.ID}
	err := s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := s.getPharmacy(ctx, tx, actor, req.PharmacyID, true)
		if err != nil {
			return err
		}
		ret.ResponsibleSellerID = p.ResponsibleSellerID
		if err := tx.Create(ret).Error; err != nil {
			return err
		}
		seen := map[uuid.UUID]bool{}
		for _, input := range req.Items {
			if seen[input.ProductID] {
				return apperrors.BadRequest("duplicate product in return")
			}
			seen[input.ProductID] = true
			var qty int
			if err := tx.Raw("SELECT COALESCE(quantity,0) FROM pharmacy_stock WHERE pharmacy_id=? AND product_id=?", p.ID, input.ProductID).Scan(&qty).Error; err != nil {
				return err
			}
			if input.Quantity > qty {
				return apperrors.BadRequest("return quantity exceeds pharmacy stock")
			}
			var unitValue float64
			if err := tx.Raw(`
				SELECT COALESCE(SUM(ii.net_unit_price*ii.quantity)/NULLIF(SUM(ii.quantity),0),0)
				FROM pharmacy_invoice_items ii JOIN pharmacy_invoices i ON i.id=ii.invoice_id
				WHERE i.pharmacy_id=? AND i.status='accepted' AND ii.product_id=?
			`, p.ID, input.ProductID).Scan(&unitValue).Error; err != nil {
				return err
			}
			item := &ReturnItem{ID: uuid.New(), ReturnID: ret.ID, ProductID: input.ProductID, RequestedQuantity: input.Quantity, UnitDebtValue: money(unitValue)}
			if err := tx.Create(item).Error; err != nil {
				return err
			}
		}
		return event(tx, p.ID, ret.ID, actor.ID, "return", "return_requested", map[string]interface{}{"reason": ret.Reason})
	})
	return ret, err
}

func (s *Service) ProcessReturn(ctx context.Context, actor Actor, id uuid.UUID, req ProcessReturnRequest) error {
	if actor.Role != "owner" && actor.Role != "warehouse_manager" {
		return apperrors.Forbidden("only owner or warehouse manager can process returns")
	}
	return s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var ret PharmacyReturn
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", id).First(&ret).Error; err != nil {
			return apperrors.NotFound("return")
		}
		if ret.Status != "requested" {
			return apperrors.Conflict("return has already been processed")
		}
		var items []ReturnItem
		if err := tx.Where("return_id=?", ret.ID).Find(&items).Error; err != nil {
			return err
		}
		inputs := map[uuid.UUID]int{}
		for _, x := range req.Items {
			inputs[x.ItemID] = x.AcceptedQuantity
		}
		totalAccepted, totalRequested := 0, 0
		for i := range items {
			accepted, ok := inputs[items[i].ID]
			if !ok {
				return apperrors.BadRequest("accepted quantity is required for every return item")
			}
			if accepted < 0 || accepted > items[i].RequestedQuantity {
				return apperrors.BadRequest("invalid accepted quantity")
			}
			totalRequested += items[i].RequestedQuantity
			totalAccepted += accepted
			if accepted == 0 {
				continue
			}
			var stock int
			if err := tx.Raw(`SELECT quantity FROM pharmacy_stock WHERE pharmacy_id=? AND product_id=? FOR UPDATE`, ret.PharmacyID, items[i].ProductID).Scan(&stock).Error; err != nil {
				return err
			}
			if accepted > stock {
				return apperrors.Conflict("pharmacy stock changed; accepted quantity is no longer available")
			}
			if err := tx.Exec(`UPDATE pharmacy_stock SET quantity=quantity-?,updated_at=NOW() WHERE pharmacy_id=? AND product_id=?`, accepted, ret.PharmacyID, items[i].ProductID).Error; err != nil {
				return err
			}
			remainingQty := accepted
			var invoiceItems []InvoiceItem
			if err := tx.Raw(`
				SELECT ii.*, COALESCE((
					SELECT SUM(ra.quantity) FROM pharmacy_return_allocations ra
					WHERE ra.invoice_id=ii.invoice_id AND ra.return_item_id IN
						(SELECT ri.id FROM pharmacy_return_items ri WHERE ri.product_id=ii.product_id)
				),0)::int returned_quantity
				FROM pharmacy_invoice_items ii JOIN pharmacy_invoices i ON i.id=ii.invoice_id
				WHERE i.pharmacy_id=? AND i.status='accepted' AND ii.product_id=?
				ORDER BY i.accepted_at ASC,i.id ASC
			`, ret.PharmacyID, items[i].ProductID).Scan(&invoiceItems).Error; err != nil {
				return err
			}
			var returnedAmount float64
			for _, ii := range invoiceItems {
				if remainingQty == 0 {
					break
				}
				var already int
				if err := tx.Raw(`SELECT COALESCE(SUM(quantity),0) FROM pharmacy_return_allocations
					WHERE invoice_id=? AND return_item_id IN (SELECT id FROM pharmacy_return_items WHERE product_id=?)`, ii.InvoiceID, ii.ProductID).Scan(&already).Error; err != nil {
					return err
				}
				available := ii.Quantity - already
				if available <= 0 {
					continue
				}
				qty := available
				if qty > remainingQty {
					qty = remainingQty
				}
				amount := money(float64(qty) * ii.NetUnitPrice)
				if err := tx.Exec(`INSERT INTO pharmacy_return_allocations(id,return_item_id,invoice_id,quantity,amount)
					VALUES (?,?,?,?,?)`, uuid.New(), items[i].ID, ii.InvoiceID, qty, amount).Error; err != nil {
					return err
				}
				var sourceInvoice Invoice
				if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", ii.InvoiceID).First(&sourceInvoice).Error; err != nil {
					return err
				}
				openDebt := money(sourceInvoice.TotalAmount - sourceInvoice.PaidAmount - sourceInvoice.ReturnedAmount)
				debtReduction := money(math.Min(math.Max(openDebt, 0), amount))
				if debtReduction > 0 {
					if err := tx.Model(&sourceInvoice).UpdateColumn("returned_amount", gorm.Expr("returned_amount + ?", debtReduction)).Error; err != nil {
						return err
					}
				}
				if excess := money(amount - debtReduction); excess > 0 {
					if err := tx.Exec(`INSERT INTO pharmacy_credit_ledger
						(id,pharmacy_id,invoice_id,return_id,amount,entry_type,created_by)
						VALUES (?,?,?,?,?,'credit',?)`,
						uuid.New(), ret.PharmacyID, ii.InvoiceID, ret.ID, excess, actor.ID).Error; err != nil {
						return err
					}
				}
				if err := s.inventory.ReturnExternalTx(ctx, tx, actor.ID, ii.ProductID, ret.ID, qty, ii.UnitCost, "Возврат из аптеки · "+ret.ReturnNumber); err != nil {
					return err
				}
				returnedAmount = money(returnedAmount + amount)
				remainingQty -= qty
			}
			if remainingQty > 0 {
				return apperrors.Conflict("return exceeds issued product history")
			}
			if err := tx.Model(&items[i]).Updates(map[string]interface{}{"accepted_quantity": accepted, "returned_amount": returnedAmount}).Error; err != nil {
				return err
			}
		}
		status := "rejected"
		if totalAccepted == totalRequested {
			status = "accepted"
		} else if totalAccepted > 0 {
			status = "partially_accepted"
		}
		if status == "rejected" && (req.RejectionReason == nil || strings.TrimSpace(*req.RejectionReason) == "") {
			return apperrors.BadRequest("rejection reason is required when nothing is accepted")
		}
		now := time.Now().UTC()
		if err := tx.Model(&ret).Updates(map[string]interface{}{"status": status, "rejection_reason": req.RejectionReason, "processed_by": actor.ID, "processed_at": now}).Error; err != nil {
			return err
		}
		return event(tx, ret.PharmacyID, ret.ID, actor.ID, "return", "return_"+status, map[string]interface{}{"accepted_quantity": totalAccepted})
	})
}
