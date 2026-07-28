package pharmacies

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }
func (r *Repository) DB() *gorm.DB          { return r.db }

func (r *Repository) List(ctx context.Context, actor Actor, includeArchived bool) ([]PharmacyListRow, error) {
	q := r.db.WithContext(ctx).Table("pharmacies p").
		Select(`
			p.*, u.full_name AS responsible_seller_name,
			COALESCE(st.stock_quantity, 0)::int AS stock_quantity,
			COALESCE(inv.issued_amount, 0) AS issued_amount,
			GREATEST(COALESCE(inv.debt, 0) - COALESCE(cr.credit, 0), 0) AS current_debt,
			GREATEST(COALESCE(cr.credit, 0) - COALESCE(inv.debt, 0), 0) AS credit_balance,
			CASE WHEN GREATEST(COALESCE(inv.debt, 0) - COALESCE(cr.credit, 0), 0) > 0
				THEN 'has_debt' ELSE 'no_debt' END AS debt_status`).
		Joins("JOIN users u ON u.id = p.responsible_seller_id").
		Joins(`LEFT JOIN (
			SELECT pharmacy_id, SUM(quantity) stock_quantity
			FROM pharmacy_stock GROUP BY pharmacy_id
		) st ON st.pharmacy_id = p.id`).
		Joins(`LEFT JOIN (
			SELECT pharmacy_id,
				SUM(total_amount) FILTER (WHERE status = 'accepted') issued_amount,
				SUM(GREATEST(total_amount-paid_amount-returned_amount, 0))
					FILTER (WHERE status = 'accepted') debt
			FROM pharmacy_invoices GROUP BY pharmacy_id
		) inv ON inv.pharmacy_id = p.id`).
		Joins(`LEFT JOIN (
			SELECT pharmacy_id, SUM(CASE WHEN entry_type='credit' THEN amount ELSE -ABS(amount) END) credit
			FROM pharmacy_credit_ledger GROUP BY pharmacy_id
		) cr ON cr.pharmacy_id = p.id`)
	if !includeArchived {
		q = q.Where("p.archived_at IS NULL")
	}
	if actor.Role == "seller" {
		q = q.Where("p.responsible_seller_id = ?", actor.ID)
	}
	var rows []PharmacyListRow
	if err := q.Order("p.created_at DESC").Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list pharmacies: %w", err)
	}
	return rows, nil
}

func (r *Repository) Dashboard(ctx context.Context, actor Actor, from, to time.Time) (Dashboard, error) {
	var sellerID *uuid.UUID
	if actor.Role == "seller" {
		sellerID = &actor.ID
	}
	var out Dashboard
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			COUNT(DISTINCT p.id) FILTER (
				WHERE p.archived_at IS NULL AND (?::uuid IS NULL OR p.responsible_seller_id=?)
			)::int active_pharmacies,
			COALESCE((SELECT SUM(ps.quantity) FROM pharmacy_stock ps
				JOIN pharmacies px ON px.id=ps.pharmacy_id
				WHERE px.archived_at IS NULL AND (?::uuid IS NULL OR px.responsible_seller_id=?)),0)::int goods_quantity,
			COALESCE((SELECT SUM(GREATEST(i.total_amount-i.paid_amount-i.returned_amount,0))
				FROM pharmacy_invoices i JOIN pharmacies px ON px.id=i.pharmacy_id
				WHERE i.status='accepted' AND px.archived_at IS NULL
				  AND (?::uuid IS NULL OR px.responsible_seller_id=?)),0) total_debt,
			COALESCE((SELECT SUM(pp.amount) FROM pharmacy_payments pp
				JOIN pharmacies px ON px.id=pp.pharmacy_id
				WHERE pp.status='confirmed' AND pp.confirmed_at>=? AND pp.confirmed_at<=?
				  AND (?::uuid IS NULL OR px.responsible_seller_id=?)),0) paid_in_period
		FROM pharmacies p
	`, sellerID, sellerID, sellerID, sellerID, sellerID, sellerID, from, to, sellerID, sellerID).Scan(&out).Error
	if err != nil {
		return Dashboard{}, fmt.Errorf("pharmacy dashboard: %w", err)
	}
	return out, nil
}

func (r *Repository) Detail(ctx context.Context, actor Actor, id uuid.UUID) (*DetailResponse, error) {
	rows, err := r.List(ctx, actor, true)
	if err != nil {
		return nil, err
	}
	var selected *PharmacyListRow
	for i := range rows {
		if rows[i].ID == id {
			selected = &rows[i]
			break
		}
	}
	if selected == nil {
		return nil, nil
	}
	out := &DetailResponse{Pharmacy: *selected}
	if err := r.db.WithContext(ctx).Raw(`
		SELECT ps.product_id,p.name product_name,p.sku,
			COALESCE((SELECT image_url FROM product_images pi WHERE pi.product_id=p.id
				ORDER BY pi.is_primary DESC,pi.sort_order LIMIT 1),'') image_url,
			ps.quantity
		FROM pharmacy_stock ps JOIN products p ON p.id=ps.product_id
		WHERE ps.pharmacy_id=? AND ps.quantity>0 ORDER BY p.name
	`, id).Scan(&out.Stock).Error; err != nil {
		return nil, err
	}
	var invoices []Invoice
	if err := r.db.WithContext(ctx).Where("pharmacy_id=?", id).Order("created_at DESC").Find(&invoices).Error; err != nil {
		return nil, err
	}
	for _, invoice := range invoices {
		row := InvoiceDetail{Invoice: invoice}
		if err := r.db.WithContext(ctx).Raw(`
			SELECT ii.*,p.name product_name,p.sku,
				COALESCE((SELECT image_url FROM product_images pi WHERE pi.product_id=p.id
					ORDER BY pi.is_primary DESC,pi.sort_order LIMIT 1),'') image_url
			FROM pharmacy_invoice_items ii JOIN products p ON p.id=ii.product_id
			WHERE ii.invoice_id=? ORDER BY p.name
		`, invoice.ID).Scan(&row.Items).Error; err != nil {
			return nil, err
		}
		out.Invoices = append(out.Invoices, row)
	}
	if err := r.db.WithContext(ctx).Where("pharmacy_id=?", id).Order("created_at DESC").Find(&out.Payments).Error; err != nil {
		return nil, err
	}
	var returns []PharmacyReturn
	if err := r.db.WithContext(ctx).Where("pharmacy_id=?", id).Order("created_at DESC").Find(&returns).Error; err != nil {
		return nil, err
	}
	for _, ret := range returns {
		row := ReturnDetail{PharmacyReturn: ret}
		if err := r.db.WithContext(ctx).Raw(`
			SELECT ri.*,p.name product_name FROM pharmacy_return_items ri
			JOIN products p ON p.id=ri.product_id WHERE ri.return_id=? ORDER BY p.name
		`, ret.ID).Scan(&row.Items).Error; err != nil {
			return nil, err
		}
		out.Returns = append(out.Returns, row)
	}
	if err := r.db.WithContext(ctx).Raw(`
		SELECT e.id,e.entity_type,e.entity_id,e.event_type,u.full_name actor_name,e.metadata,e.created_at
		FROM pharmacy_events e JOIN users u ON u.id=e.actor_id
		WHERE e.pharmacy_id=? ORDER BY e.created_at DESC LIMIT 200
	`, id).Scan(&out.Timeline).Error; err != nil {
		return nil, err
	}
	return out, nil
}
