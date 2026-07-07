package products

// dto_test.go — Pure unit tests for product price validation hardening.
//
// No database, no network required. Run with: go test ./internal/products/ -v

import (
	"testing"

	"github.com/megamall/crm/pkg/validator"
)

func TestCreateProductRequest_PriceWithinBoundsAccepted(t *testing.T) {
	price := 999.99
	req := CreateProductRequest{SKU: "SKU-1", Name: "Widget", PurchasePrice: &price, SalePrice: &price}
	if appErr := validator.Validate(req); appErr != nil {
		t.Fatalf("expected a normal price to be accepted, got: %v", appErr)
	}
}

func TestCreateProductRequest_PriceOverMaxRejected(t *testing.T) {
	tooHigh := 10000001.0
	req := CreateProductRequest{SKU: "SKU-1", Name: "Widget", SalePrice: &tooHigh}
	if appErr := validator.Validate(req); appErr == nil {
		t.Fatal("expected a sale_price over the max to be rejected")
	}

	req2 := CreateProductRequest{SKU: "SKU-1", Name: "Widget", PurchasePrice: &tooHigh}
	if appErr := validator.Validate(req2); appErr == nil {
		t.Fatal("expected a purchase_price over the max to be rejected")
	}
}

func TestCreateProductRequest_PriceAtMaxAccepted(t *testing.T) {
	atMax := 10000000.0
	req := CreateProductRequest{SKU: "SKU-1", Name: "Widget", SalePrice: &atMax}
	if appErr := validator.Validate(req); appErr != nil {
		t.Fatalf("expected sale_price at exactly the max to be accepted, got: %v", appErr)
	}
}

func TestUpdateProductRequest_PriceOverMaxRejected(t *testing.T) {
	tooHigh := 50000000.0
	req := UpdateProductRequest{SalePrice: &tooHigh}
	if appErr := validator.Validate(req); appErr == nil {
		t.Fatal("expected an update sale_price over the max to be rejected")
	}
}
