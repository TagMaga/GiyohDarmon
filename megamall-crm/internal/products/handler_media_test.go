package products_test

// handler_media_test.go — HTTP-level RBAC proof for the Phase 2 product-
// image fields: the existing route-level RBAC (writeRoles = owner,
// warehouse_manager; see routes.go) is completely untouched by this phase,
// but this test drives the real handler+routes+service stack end-to-end to
// prove that still holds for the *new* primary_image_media_asset_id field
// too — a request that would otherwise succeed for an authorized role must
// still be rejected for an unauthorized one.
//
// Run with: go test ./internal/products/ -v -run TestProductsHandler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/megamall/crm/internal/products"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	apperrors "github.com/megamall/crm/pkg/errors"
	"github.com/megamall/crm/pkg/middleware"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// buildProductsTestRouter wires products.RegisterRoutes with a fake
// validator that trusts the role passed as the Bearer token value —
// mirrors internal/orders/rbac_test.go's established pattern.
func buildProductsTestRouter(svc *products.Service) *gin.Engine {
	middleware.SetTokenValidator(func(_ context.Context, token string) (*middleware.ContextClaims, error) {
		if token == "" {
			return nil, apperrors.Unauthorized("no token")
		}
		return &middleware.ContextClaims{Role: token}, nil
	})

	r := gin.New()
	h := products.NewHandler(svc)
	h.RegisterRoutes(r.Group("/api/v1"))
	return r
}

func postAsRole(r *gin.Engine, path, role string, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if role != "" {
		req.Header.Set("Authorization", "Bearer "+role)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

// TestProductsHandler_CreateWithImage_OwnerAllowed_SellerForbidden proves
// the write-role gate still applies to a create request carrying the new
// primary_image_media_asset_id field: an owner succeeds end-to-end
// (attach really happens), a seller gets 403 without ever reaching the
// service layer.
func TestProductsHandler_CreateWithImage_OwnerAllowed_SellerForbidden(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	r := buildProductsTestRouter(svc)

	uploader := testutil.CreateUser(t, db, users.RoleOwner)
	asset := uploadProductImage(t, mediaSvc, uploader.ID, fixture(t, "transparent.png"))

	body := map[string]any{
		"name":                         "HTTP Widget",
		"primary_image_media_asset_id": asset.ID.String(),
	}

	sellerRec := postAsRole(r, "/api/v1/products", "seller", body)
	if sellerRec.Code != http.StatusForbidden {
		t.Errorf("seller: status = %d, want 403 — write-role gate must reject this exactly as before", sellerRec.Code)
	}

	ownerRec := postAsRole(r, "/api/v1/products", "owner", body)
	if ownerRec.Code != http.StatusCreated {
		t.Fatalf("owner: status = %d, want 201, body=%s", ownerRec.Code, ownerRec.Body.String())
	}

	var out struct {
		Data products.ProductResponse `json:"data"`
	}
	if err := json.Unmarshal(ownerRec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(out.Data.Images) != 1 || out.Data.Images[0].CardURL == nil {
		t.Fatalf("expected the image to be attached with variant URLs in the HTTP response: %+v", out.Data.Images)
	}
}

// TestProductsHandler_CreateWithImage_WarehouseManagerAllowed proves the
// second write-capable role (warehouse_manager) also still works.
func TestProductsHandler_CreateWithImage_WarehouseManagerAllowed(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	r := buildProductsTestRouter(svc)

	uploader := testutil.CreateUser(t, db, users.RoleWarehouseManager)
	asset := uploadProductImage(t, mediaSvc, uploader.ID, fixture(t, "transparent.png"))

	rec := postAsRole(r, "/api/v1/products", "warehouse_manager", map[string]any{
		"name":                         "Warehouse Widget",
		"primary_image_media_asset_id": asset.ID.String(),
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("warehouse_manager: status = %d, want 201, body=%s", rec.Code, rec.Body.String())
	}
}

// TestProductsHandler_AddImage_UnauthorizedRoleRejected proves the
// image-attach sub-endpoint (POST /products/:id/images) keeps its existing
// write-role gate for the new media_asset_id field too.
func TestProductsHandler_AddImage_UnauthorizedRoleRejected(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc, mediaSvc := setupWithMedia(t, db)
	r := buildProductsTestRouter(svc)

	owner := testutil.CreateUser(t, db, users.RoleOwner)
	p, err := svc.CreateProduct(context.Background(), owner.ID, products.CreateProductRequest{Name: "Base Product"})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}
	asset := uploadProductImage(t, mediaSvc, owner.ID, fixture(t, "transparent.png"))

	for _, role := range []string{"seller", "dispatcher", "manager", "sales_team_lead", "courier"} {
		rec := postAsRole(r, "/api/v1/products/"+p.ID.String()+"/images", role, map[string]any{
			"media_asset_id": asset.ID.String(),
		})
		if rec.Code != http.StatusForbidden {
			t.Errorf("role %q: status = %d, want 403", role, rec.Code)
		}
	}
}

// TestProductsHandler_MediaDisabled_ImageFieldRejected_LegacyStillWorks
// drives the disabled-flag state through the real HTTP stack: the same
// owner request that would succeed with media enabled gets a clean 400 for
// the image field when disabled, while a plain (no-image) create by the
// same role still succeeds — the handler-level mirror of
// TestCreateProduct_MediaDisabled_LegacyFlowUnaffected.
func TestProductsHandler_MediaDisabled_ImageFieldRejected_LegacyStillWorks(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := setupWithoutMedia(t, db)
	r := buildProductsTestRouter(svc)

	rejected := postAsRole(r, "/api/v1/products", "owner", map[string]any{
		"name":                         "Should Fail",
		"primary_image_media_asset_id": "00000000-0000-0000-0000-000000000000",
	})
	if rejected.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 when media pipeline is disabled", rejected.Code)
	}

	ok := postAsRole(r, "/api/v1/products", "owner", map[string]any{"name": "Plain Product"})
	if ok.Code != http.StatusCreated {
		t.Errorf("plain create (no image) status = %d, want 201 even with media disabled, body=%s", ok.Code, ok.Body.String())
	}
}
