package agentmonitor

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const samplePromptJSON = `{
  "promptId":"p-1",
  "promptName":"refund-agent",
  "promptVersionId":"v-1",
  "versionNumber":3,
  "environment":"production",
  "content":"You are a refund agent v3",
  "variablesSchema":{"type":"object"},
  "modelDefaults":{"temperature":0.2},
  "etag":"\"pv-abc\"",
  "deployedAt":"2026-08-26T00:00:00Z"
}`

func newSampleServer(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *PromptRuntimeClient) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	c := NewPromptRuntimeClient(srv.URL, "amt_test", "proj-1", 50*time.Millisecond, nil)
	return srv, c
}

func TestPromptRuntimeFirstFetch(t *testing.T) {
	var seenURL string
	var seenAuth string
	_, c := newSampleServer(t, func(w http.ResponseWriter, r *http.Request) {
		seenURL = r.URL.String()
		seenAuth = r.Header.Get("Authorization")
		w.Header().Set("ETag", `"pv-abc"`)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(samplePromptJSON))
	})
	p, err := c.Get(context.Background(), "refund-agent", nil)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if p.PromptVersionID != "v-1" || p.VersionNumber != 3 {
		t.Fatalf("unexpected prompt: %+v", p)
	}
	if seenAuth != "Bearer amt_test" {
		t.Fatalf("expected bearer token, got %q", seenAuth)
	}
	if seenURL == "" || !strings.Contains(seenURL, "projectId=proj-1") || !strings.Contains(seenURL, "environment=production") {
		t.Fatalf("unexpected url: %s", seenURL)
	}
}

func TestPromptRuntimeTTLCacheHit(t *testing.T) {
	calls := 0
	_, c := newSampleServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("ETag", `"pv-abc"`)
		_, _ = w.Write([]byte(samplePromptJSON))
	})
	_, _ = c.Get(context.Background(), "refund-agent", nil)
	_, _ = c.Get(context.Background(), "refund-agent", nil)
	if calls != 1 {
		t.Fatalf("expected 1 network call within TTL, got %d", calls)
	}
}

func TestPromptRuntime304ExtendsTTL(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	_, c := newSampleServer(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		n := calls
		mu.Unlock()
		switch n {
		case 1:
			w.Header().Set("ETag", `"pv-abc"`)
			_, _ = w.Write([]byte(samplePromptJSON))
		case 2:
			if r.Header.Get("If-None-Match") != `"pv-abc"` {
				http.Error(w, "missing If-None-Match", http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusNotModified)
		default:
			http.Error(w, "should not be called again", http.StatusInternalServerError)
		}
	})
	first, err := c.Get(context.Background(), "refund-agent", nil)
	if err != nil {
		t.Fatalf("first Get: %v", err)
	}
	time.Sleep(80 * time.Millisecond) // 超过 TTL（50ms）
	second, err := c.Get(context.Background(), "refund-agent", nil)
	if err != nil {
		t.Fatalf("second Get: %v", err)
	}
	if first.PromptVersionID != second.PromptVersionID {
		t.Fatalf("304 should reuse cached prompt: first=%s second=%s", first.PromptVersionID, second.PromptVersionID)
	}
	// 304 应刷新 TTL，再次立即获取不应发请求
	_, _ = c.Get(context.Background(), "refund-agent", nil)
	mu.Lock()
	defer mu.Unlock()
	if calls != 2 {
		t.Fatalf("expected 2 calls, got %d", calls)
	}
}

func TestPromptRuntime200OverwritesCache(t *testing.T) {
	step := 0
	_, c := newSampleServer(t, func(w http.ResponseWriter, r *http.Request) {
		step++
		if step == 1 {
			w.Header().Set("ETag", `"pv-abc"`)
			_, _ = w.Write([]byte(samplePromptJSON))
			return
		}
		updated := ResolvedPrompt{
			PromptID:        "p-1",
			PromptName:      "refund-agent",
			PromptVersionID: "v-2",
			VersionNumber:   4,
			Environment:     "production",
			Content:         "v4",
			ETag:            `"pv-new"`,
		}
		w.Header().Set("ETag", `"pv-new"`)
		_ = json.NewEncoder(w).Encode(updated)
	})
	v1, _ := c.Get(context.Background(), "refund-agent", nil)
	v2, err := c.Get(context.Background(), "refund-agent", &GetPromptOptions{ForceRefresh: true})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if v1.PromptVersionID != "v-1" || v2.PromptVersionID != "v-2" || v2.Content != "v4" {
		t.Fatalf("unexpected versions v1=%+v v2=%+v", v1, v2)
	}
}

func TestPromptRuntimeEnvironmentIsolation(t *testing.T) {
	_, c := newSampleServer(t, func(w http.ResponseWriter, r *http.Request) {
		env := r.URL.Query().Get("environment")
		p := ResolvedPrompt{
			PromptID:        "p-1",
			PromptName:      "refund-agent",
			PromptVersionID: "v-" + env,
			VersionNumber:   1,
			Environment:     env,
			Content:         env,
			ETag:            `"etag-` + env + `"`,
		}
		_ = json.NewEncoder(w).Encode(p)
	})
	prod, _ := c.Get(context.Background(), "refund-agent", &GetPromptOptions{Environment: PromptEnvProduction})
	stg, _ := c.Get(context.Background(), "refund-agent", &GetPromptOptions{Environment: PromptEnvStaging})
	if prod.Environment != "production" || stg.Environment != "staging" {
		t.Fatalf("env mismatch: %+v vs %+v", prod, stg)
	}
	if c.CacheSize() != 2 {
		t.Fatalf("expected 2 cache entries, got %d", c.CacheSize())
	}
}

func TestPromptRuntimeErrorResponse(t *testing.T) {
	_, c := newSampleServer(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	})
	_, err := c.Get(context.Background(), "missing", nil)
	if err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("expected 404 error, got %v", err)
	}
}

func TestPromptRuntimeClearCache(t *testing.T) {
	_, c := newSampleServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"pv-abc"`)
		_, _ = w.Write([]byte(samplePromptJSON))
	})
	_, _ = c.Get(context.Background(), "refund-agent", nil)
	if c.CacheSize() != 1 {
		t.Fatalf("expected cache size 1, got %d", c.CacheSize())
	}
	c.ClearCache()
	if c.CacheSize() != 0 {
		t.Fatalf("expected cache cleared, got %d", c.CacheSize())
	}
}
