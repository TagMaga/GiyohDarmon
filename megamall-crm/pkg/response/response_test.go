package response

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

type item struct {
	Name string `json:"name"`
}

type nested struct {
	Items []item `json:"items"`
}

type detail struct {
	Stock    []item   `json:"stock"`
	Invoices []nested `json:"invoices"`
	Raw      []byte   `json:"raw"`
}

func decodeData(t *testing.T, body []byte) map[string]interface{} {
	t.Helper()
	var out map[string]interface{}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	return out
}

func TestOK_NilTopLevelSliceBecomesEmptyArray(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	var rows []item // nil, as GORM leaves it on zero results
	OK(c, rows)

	out := decodeData(t, w.Body.Bytes())
	data, ok := out["data"].([]interface{})
	if !ok {
		t.Fatalf("expected data to decode as an array, got %#v (raw: %s)", out["data"], w.Body.String())
	}
	if len(data) != 0 {
		t.Fatalf("expected empty array, got %v", data)
	}
}

func TestOK_NilNestedSliceFieldsBecomeEmptyArrays(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	d := detail{} // Stock, Invoices, Raw all nil
	OK(c, d)

	if body := w.Body.String(); containsNull(body, "stock") || containsNull(body, "invoices") {
		t.Fatalf("expected stock/invoices to serialize as [], got: %s", body)
	}

	out := decodeData(t, w.Body.Bytes())
	data := out["data"].(map[string]interface{})
	if stock, ok := data["stock"].([]interface{}); !ok || len(stock) != 0 {
		t.Fatalf("expected stock to be [], got %#v", data["stock"])
	}
	if invoices, ok := data["invoices"].([]interface{}); !ok || len(invoices) != 0 {
		t.Fatalf("expected invoices to be [], got %#v", data["invoices"])
	}
	// []byte must still round-trip as JSON null when nil, not become "".
	if raw, present := data["raw"]; !present || raw != nil {
		t.Fatalf("expected raw ([]byte) to stay null, got %#v", raw)
	}
}

func TestOK_PopulatedNestedSlicesPreserved(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	d := detail{
		Invoices: []nested{{Items: nil}, {Items: []item{{Name: "x"}}}},
	}
	OK(c, d)

	out := decodeData(t, w.Body.Bytes())
	data := out["data"].(map[string]interface{})
	invoices := data["invoices"].([]interface{})
	first := invoices[0].(map[string]interface{})
	if items, ok := first["items"].([]interface{}); !ok || len(items) != 0 {
		t.Fatalf("expected first invoice's nil items to become [], got %#v", first["items"])
	}
	second := invoices[1].(map[string]interface{})
	items := second["items"].([]interface{})
	if len(items) != 1 || items[0].(map[string]interface{})["name"] != "x" {
		t.Fatalf("expected second invoice's items preserved, got %#v", items)
	}
}

func containsNull(body, field string) bool {
	return jsonContains(body, `"`+field+`":null`)
}

func jsonContains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if haystack[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}
