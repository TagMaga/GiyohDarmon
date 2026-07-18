package logistics

// media_integration_test.go — Phase 1 (remaining uploads): confirms the
// owner logistics dashboard's cash-handover list (GET
// /owner/logistics/cash-handovers) resolves centralized-media-pipeline
// proofs into media_assets, via Handler.SetMediaAdapters +
// resolveHandoverMediaAssets — mirrors internal/courier's own
// ToHandoverResponse test coverage, for this separate read path (see
// internal/logistics/mediabridge/bridge.go's doc comment for why this
// package needed its own adapters instead of reusing internal/courier's).
//
// Uses a scratch DB (via internal/testutil) and a temporary upload
// directory only — never production.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/megamall/crm/config"
	"github.com/megamall/crm/internal/media"
	"github.com/megamall/crm/internal/testutil"
	"github.com/megamall/crm/internal/users"
	"github.com/megamall/crm/tools/imagebench"
)

const logisticsTestMediaSecret = "logistics-media-integration-test-secret"

func logisticsTestMediaCfg(t *testing.T) config.MediaConfig {
	t.Helper()
	return config.MediaConfig{
		MaxUploadBytes:        40 << 20,
		MaxImageBytes:         35 << 20,
		MaxDocumentBytes:      20 << 20,
		MaxPixels:             40_000_000,
		MaxDimension:          12000,
		SigningSecret:         logisticsTestMediaSecret,
		SignedURLTTL:          15 * time.Minute,
		QuarantineRetention:   30 * 24 * time.Hour,
		ProcessingConcurrency: 2,
		ProcessingTimeout:     60 * time.Second,
		UploadDir:             t.TempDir(),
	}
}

// testLogisticsMediaAdapters duplicates (rather than imports)
// internal/logistics/mediabridge's logic: that package imports
// internal/logistics itself (to reference ListCashHandoverProofsFn/
// SignedMediaURLFn), so a test file inside package logistics can't import
// it without an import cycle — see internal/orders/media_integration_test.go's
// identical reasoning for the sibling orders package.
func testLogisticsMediaAdapters(mediaSvc *media.Service) (ListCashHandoverProofsFn, SignedMediaURLFn) {
	list := func(ctx context.Context, handoverID uuid.UUID) ([]MediaAssetInfo, error) {
		assets, err := mediaSvc.ListByOwner(ctx, "cash_handovers", handoverID)
		if err != nil {
			return nil, err
		}
		out := make([]MediaAssetInfo, 0, len(assets))
		for _, a := range assets {
			out = append(out, MediaAssetInfo{ID: a.ID, Width: a.Width, Height: a.Height})
		}
		return out, nil
	}

	signedURL := func(ctx context.Context, assetID uuid.UUID, variant string) string {
		asset, err := mediaSvc.GetByID(ctx, assetID)
		if err != nil || asset == nil {
			return ""
		}
		signed, err := mediaSvc.SignedURL(asset, variant)
		if err != nil {
			return ""
		}
		return signed.URL
	}

	return list, signedURL
}

func getHandovers(r *gin.Engine, actorRole string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/owner/logistics/cash-handovers", nil)
	req.Header.Set("Authorization", "Bearer "+actorRole)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestListHandovers_ResolvesMediaAssetPipelineProof(t *testing.T) {
	db := testutil.NewTestDB(t)
	courierUser := testutil.CreateUser(t, db, users.RoleCourier)
	repo := NewRepository(db, time.UTC)
	h := NewHandler(repo, time.UTC)

	mediaSvc := media.NewService(media.NewRepository(db), logisticsTestMediaCfg(t))
	list, signedURL := testLogisticsMediaAdapters(mediaSvc)
	h.SetMediaAdapters(list, signedURL)

	r := buildHandoverRouter(h, "owner")

	row, err := repo.CreateHandover(context.Background(), CreateHandoverReq{
		CourierID:      courierUser.ID,
		TotalCollected: 500,
		TotalToReturn:  450,
	})
	if err != nil {
		t.Fatalf("create handover fixture: %v", err)
	}

	all, genErr := imagebench.GenerateAll()
	if genErr != nil {
		t.Fatalf("generate fixtures: %v", genErr)
	}
	var proofBytes []byte
	for _, f := range all {
		if f.Name == "transparent.png" {
			proofBytes = f.Bytes
			break
		}
	}
	if proofBytes == nil {
		t.Fatal("transparent.png fixture not found")
	}

	asset, appErr := mediaSvc.Create(context.Background(), media.CreateParams{
		Category:         media.CategoryCashHandoverProof,
		UploadedByUserID: courierUser.ID,
		OriginalFilename: "proof.png",
		DeclaredSize:     int64(len(proofBytes)),
	}, bytes.NewReader(proofBytes))
	if appErr != nil {
		t.Fatalf("upload proof fixture: %v", appErr)
	}
	if _, err := mediaSvc.AttachToOwner(context.Background(), asset.ID, media.CategoryCashHandoverProof, "cash_handovers", row.ID); err != nil {
		t.Fatalf("attach proof to handover: %v", err)
	}

	w := getHandovers(r, "owner")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body=%s", w.Code, w.Body.String())
	}

	var body struct {
		Data []HandoverListRow `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	var found *HandoverListRow
	for i := range body.Data {
		if body.Data[i].ID == row.ID {
			found = &body.Data[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("handover %s not found in list response", row.ID)
	}
	if len(found.MediaAssets) != 1 {
		t.Fatalf("expected 1 resolved media asset, got %d: %+v", len(found.MediaAssets), found.MediaAssets)
	}
	if found.MediaAssets[0].URL == "" {
		t.Error("expected a freshly-resolved signed URL for the proof asset")
	}
	if found.MediaAssets[0].Width == nil || *found.MediaAssets[0].Width != 1200 {
		t.Errorf("expected resolved width 1200, got %v", found.MediaAssets[0].Width)
	}
}

func TestListHandovers_MediaDisabled_NoMediaAssetsField(t *testing.T) {
	db := testutil.NewTestDB(t)
	courierUser := testutil.CreateUser(t, db, users.RoleCourier)
	repo := NewRepository(db, time.UTC)
	h := NewHandler(repo, time.UTC) // SetMediaAdapters never called — mirrors MEDIA_PIPELINE_ENABLED=false

	r := buildHandoverRouter(h, "owner")

	if _, err := repo.CreateHandover(context.Background(), CreateHandoverReq{
		CourierID:      courierUser.ID,
		TotalCollected: 500,
		TotalToReturn:  450,
	}); err != nil {
		t.Fatalf("create handover fixture: %v", err)
	}

	w := getHandovers(r, "owner")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body=%s", w.Code, w.Body.String())
	}

	var body struct {
		Data []HandoverListRow `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	for _, row := range body.Data {
		if len(row.MediaAssets) != 0 {
			t.Errorf("expected no media assets when the pipeline is disabled, got %+v", row.MediaAssets)
		}
	}
}
