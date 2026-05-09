package agentmonitor

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// testServer is a mock HTTP server that captures incoming trace requests.
type testServer struct {
	server     *httptest.Server
	requests   []TraceData
	statusCode int
	mu         sync.Mutex
}

func newTestServer(initialStatus int) *testServer {
	ts := &testServer{
		statusCode: initialStatus,
		requests:   make([]TraceData, 0),
	}

	ts.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		if r.URL.Path != "/api/v1/traces" || r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		var trace TraceData
		if err := json.NewDecoder(r.Body).Decode(&trace); err == nil {
			ts.mu.Lock()
			ts.requests = append(ts.requests, trace)
			ts.mu.Unlock()
		}

		ts.mu.Lock()
		code := ts.statusCode
		ts.mu.Unlock()

		w.WriteHeader(code)
	}))

	return ts
}

func (ts *testServer) URL() string {
	return ts.server.URL
}

func (ts *testServer) Close() {
	ts.server.Close()
}

func (ts *testServer) Requests() []TraceData {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	result := make([]TraceData, len(ts.requests))
	copy(result, ts.requests)
	return result
}

func (ts *testServer) RequestCount() int {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	return len(ts.requests)
}

func (ts *testServer) SetStatusCode(code int) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.statusCode = code
}

func createMonitor(baseURL string, bufferSize int) *AgentMonitor {
	config := &SDKConfig{
		APIKey:        "proj_key",
		BaseURL:       baseURL,
		BufferSize:    bufferSize,
		FlushInterval: 1 * time.Hour,
		SampleRate:    1.0,
	}
	return Init(config)
}

// 1. Init with defaults
func TestInitDefaults(t *testing.T) {
	config := &SDKConfig{APIKey: "proj_key"}
	monitor := Init(config)
	defer monitor.Close()

	if config.BaseURL != "http://localhost:3000" {
		t.Errorf("BaseURL default = %q, want %q", config.BaseURL, "http://localhost:3000")
	}
	if config.BufferSize != 100 {
		t.Errorf("BufferSize default = %d, want 100", config.BufferSize)
	}
	if config.FlushInterval != 5*time.Second {
		t.Errorf("FlushInterval default = %v, want 5s", config.FlushInterval)
	}
	if config.SampleRate != 1.0 {
		t.Errorf("SampleRate default = %v, want 1.0", config.SampleRate)
	}
	if len(config.AlwaysCapture) != 2 || config.AlwaysCapture[0] != "error" || config.AlwaysCapture[1] != "breakpoint" {
		t.Errorf("AlwaysCapture default = %v, want [error breakpoint]", config.AlwaysCapture)
	}
}

// 2. Disabled monitor is a no-op
func TestDisabledMonitor(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	config := &SDKConfig{
		APIKey:     "proj_key",
		BaseURL:    ts.URL(),
		Disabled:   true,
		BufferSize: 1,
		SampleRate: 1.0,
	}
	monitor := Init(config)
	defer monitor.Close()

	monitor.Trace(TraceData{Name: "should_not_send", TraceType: "test"})
	monitor.Flush()

	if ts.RequestCount() != 0 {
		t.Errorf("expected 0 requests when disabled, got %d", ts.RequestCount())
	}
}

// 3. Session start generates ID and sets state
func TestSessionStart(t *testing.T) {
	monitor := createMonitor("http://localhost:3000", 100)
	defer monitor.Close()

	// With explicit ID
	session := monitor.StartSession("my-session", map[string]interface{}{"user": "alice"})
	if session.ID != "my-session" {
		t.Errorf("Session.ID = %q, want my-session", session.ID)
	}
	if session.Metadata["user"] != "alice" {
		t.Errorf("Session.Metadata[user] = %v, want alice", session.Metadata["user"])
	}
	if session.StartedAt == "" {
		t.Error("Session.StartedAt should be set")
	}

	// With empty ID (should generate one)
	session2 := monitor.StartSession("", nil)
	if session2.ID == "" {
		t.Error("StartSession with empty ID should generate a session ID")
	}
	if !strings.HasPrefix(session2.ID, "session_") {
		t.Errorf("Generated session ID should start with 'session_', got %q", session2.ID)
	}
}

// 4. Session end sends trace and clears state
func TestSessionEnd(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	monitor := createMonitor(ts.URL(), 1)
	defer monitor.Close()

	monitor.StartSession("sess-end", nil)
	monitor.EndSession("")

	reqs := ts.Requests()
	if len(reqs) != 1 {
		t.Fatalf("expected 1 request for session end, got %d", len(reqs))
	}

	tr := reqs[0]
	if tr.TraceType != "session" {
		t.Errorf("TraceType = %q, want session", tr.TraceType)
	}
	if tr.Name != "session_end" {
		t.Errorf("Name = %q, want session_end", tr.Name)
	}
	if tr.SessionID != "sess-end" {
		t.Errorf("SessionID = %q, want sess-end", tr.SessionID)
	}
	if tr.Status != "success" {
		t.Errorf("Status = %q, want success", tr.Status)
	}
}

// 5. Trace recording with manual flush
func TestTraceManualFlush(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	monitor := createMonitor(ts.URL(), 100)
	defer monitor.Close()

	monitor.Trace(TraceData{Name: "trace1", TraceType: "test"})
	monitor.Trace(TraceData{Name: "trace2", TraceType: "test"})

	if ts.RequestCount() != 0 {
		t.Errorf("expected 0 requests before flush, got %d", ts.RequestCount())
	}

	monitor.Flush()

	reqs := ts.Requests()
	if len(reqs) != 2 {
		t.Fatalf("expected 2 requests after flush, got %d", len(reqs))
	}
	if reqs[0].Name != "trace1" {
		t.Errorf("first trace Name = %q, want trace1", reqs[0].Name)
	}
	if reqs[1].Name != "trace2" {
		t.Errorf("second trace Name = %q, want trace2", reqs[1].Name)
	}
}

// 6. Trace auto-flush when buffer is full
func TestTraceAutoFlush(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	monitor := createMonitor(ts.URL(), 2)
	defer monitor.Close()

	monitor.Trace(TraceData{Name: "auto1", TraceType: "test"})
	monitor.Trace(TraceData{Name: "auto2", TraceType: "test"})

	reqs := ts.Requests()
	if len(reqs) != 2 {
		t.Fatalf("expected 2 requests after auto flush, got %d", len(reqs))
	}
}

// 7. Trace populates timestamps
func TestTraceSetsTimestamps(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	monitor := createMonitor(ts.URL(), 1)
	defer monitor.Close()

	monitor.Trace(TraceData{Name: "ts_test", TraceType: "test", LatencyMs: 10})

	reqs := ts.Requests()
	if len(reqs) != 1 {
		t.Fatalf("expected 1 request, got %d", len(reqs))
	}

	tr := reqs[0]
	if tr.StartedAt == "" {
		t.Error("StartedAt should be populated")
	}
	if tr.EndedAt == "" {
		t.Error("EndedAt should be populated when LatencyMs > 0")
	}
}

// 8. TraceLLM records LLM traces
func TestTraceLLM(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	monitor := createMonitor(ts.URL(), 1)
	defer monitor.Close()

	monitor.TraceLLM("gpt-4", map[string]string{"prompt": "hello"}, map[string]string{"reply": "world"}, 150.5, true, "")

	reqs := ts.Requests()
	if len(reqs) != 1 {
		t.Fatalf("expected 1 request, got %d", len(reqs))
	}

	tr := reqs[0]
	if tr.TraceType != "llm" {
		t.Errorf("TraceType = %q, want llm", tr.TraceType)
	}
	if tr.Name != "gpt-4" {
		t.Errorf("Name = %q, want gpt-4", tr.Name)
	}
	if tr.LatencyMs != 150.5 {
		t.Errorf("LatencyMs = %v, want 150.5", tr.LatencyMs)
	}
	if tr.Status != "success" {
		t.Errorf("Status = %q, want success", tr.Status)
	}
}

// 9. TraceLLM error path
func TestTraceLLMError(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	monitor := createMonitor(ts.URL(), 1)
	defer monitor.Close()

	monitor.TraceLLM("gpt-4", "req", nil, 200, false, "timeout")

	reqs := ts.Requests()
	if len(reqs) != 1 {
		t.Fatalf("expected 1 request, got %d", len(reqs))
	}

	tr := reqs[0]
	if tr.Status != "error" {
		t.Errorf("Status = %q, want error", tr.Status)
	}
	if tr.Error != "timeout" {
		t.Errorf("Error = %q, want timeout", tr.Error)
	}
}

// 10. TrackMessage records message traces
func TestTrackMessage(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	monitor := createMonitor(ts.URL(), 1)
	defer monitor.Close()

	monitor.TrackMessage(MessageData{
		SessionID: "sess1",
		Role:      "user",
		Content:   "hello there",
		Metadata:  map[string]interface{}{"lang": "en"},
	})

	reqs := ts.Requests()
	if len(reqs) != 1 {
		t.Fatalf("expected 1 request, got %d", len(reqs))
	}

	tr := reqs[0]
	if tr.TraceType != "message" {
		t.Errorf("TraceType = %q, want message", tr.TraceType)
	}
	if tr.Name != "message_user" {
		t.Errorf("Name = %q, want message_user", tr.Name)
	}
	if tr.SessionID != "sess1" {
		t.Errorf("SessionID = %q, want sess1", tr.SessionID)
	}
	if tr.Status != "success" {
		t.Errorf("Status = %q, want success", tr.Status)
	}
}

// 11. TrackToolCall records tool call traces
func TestTrackToolCall(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	monitor := createMonitor(ts.URL(), 1)
	defer monitor.Close()

	monitor.TrackToolCall(ToolCallData{
		SessionID:   "sess1",
		ToolName:    "search",
		InputParams: map[string]interface{}{"q": "go testing"},
		Output:      map[string]interface{}{"results": 3},
		LatencyMs:   45.5,
	})

	reqs := ts.Requests()
	if len(reqs) != 1 {
		t.Fatalf("expected 1 request, got %d", len(reqs))
	}

	tr := reqs[0]
	if tr.TraceType != "tool_call" {
		t.Errorf("TraceType = %q, want tool_call", tr.TraceType)
	}
	if tr.Name != "search" {
		t.Errorf("Name = %q, want search", tr.Name)
	}
	if tr.Status != "success" {
		t.Errorf("Status = %q, want success", tr.Status)
	}
	if tr.LatencyMs != 45.5 {
		t.Errorf("LatencyMs = %v, want 45.5", tr.LatencyMs)
	}
}

// 12. TrackToolCall error path
func TestTrackToolCallError(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	monitor := createMonitor(ts.URL(), 1)
	defer monitor.Close()

	monitor.TrackToolCall(ToolCallData{
		SessionID:   "sess1",
		ToolName:    "calc",
		InputParams: map[string]interface{}{"expr": "1/0"},
		Error:       "division by zero",
	})

	reqs := ts.Requests()
	if len(reqs) != 1 {
		t.Fatalf("expected 1 request, got %d", len(reqs))
	}

	tr := reqs[0]
	if tr.Status != "error" {
		t.Errorf("Status = %q, want error", tr.Status)
	}
	if tr.Error != "division by zero" {
		t.Errorf("Error = %q, want division by zero", tr.Error)
	}
}

// 13. Wrap success
func TestWrapSuccess(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	monitor := createMonitor(ts.URL(), 1)
	defer monitor.Close()

	fn := func() (interface{}, error) {
		return "wrapped_result", nil
	}

	res, err := monitor.Wrap(fn, "my_operation", "sess-wrap")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res != "wrapped_result" {
		t.Errorf("result = %v, want wrapped_result", res)
	}

	reqs := ts.Requests()
	if len(reqs) != 1 {
		t.Fatalf("expected 1 request, got %d", len(reqs))
	}

	tr := reqs[0]
	if tr.TraceType != "function" {
		t.Errorf("TraceType = %q, want function", tr.TraceType)
	}
	if tr.Name != "my_operation" {
		t.Errorf("Name = %q, want my_operation", tr.Name)
	}
	if tr.Status != "success" {
		t.Errorf("Status = %q, want success", tr.Status)
	}
	if tr.SessionID != "sess-wrap" {
		t.Errorf("SessionID = %q, want sess-wrap", tr.SessionID)
	}
	if tr.Output != "wrapped_result" {
		t.Errorf("Output = %v, want wrapped_result", tr.Output)
	}
}

// 14. Wrap error
func TestWrapError(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	monitor := createMonitor(ts.URL(), 1)
	defer monitor.Close()

	expectedErr := errors.New("wrapped failure")
	fn := func() (interface{}, error) {
		return nil, expectedErr
	}

	res, err := monitor.Wrap(fn, "failing_op", "sess-wrap")
	if err != expectedErr {
		t.Fatalf("expected error %v, got %v", expectedErr, err)
	}
	if res != nil {
		t.Errorf("result = %v, want nil", res)
	}

	reqs := ts.Requests()
	if len(reqs) != 1 {
		t.Fatalf("expected 1 request, got %d", len(reqs))
	}

	tr := reqs[0]
	if tr.Status != "error" {
		t.Errorf("Status = %q, want error", tr.Status)
	}
	if tr.Error != expectedErr.Error() {
		t.Errorf("Error = %q, want %q", tr.Error, expectedErr.Error())
	}
}

// 15. Offline retry: failed traces are retried when server recovers
func TestOfflineRetry(t *testing.T) {
	ts := newTestServer(http.StatusServiceUnavailable)
	defer ts.Close()

	monitor := createMonitor(ts.URL(), 1)
	defer monitor.Close()

	// Send a trace while server is failing
	monitor.Trace(TraceData{Name: "offline_trace", TraceType: "test"})

	// Recover server
	ts.SetStatusCode(http.StatusOK)

	// Send another trace to trigger flush and set isOnline=true
	monitor.Trace(TraceData{Name: "online_trace", TraceType: "test"})

	reqs := ts.Requests()

	hasOffline := false
	hasOnline := false
	for _, r := range reqs {
		if r.Name == "offline_trace" {
			hasOffline = true
		}
		if r.Name == "online_trace" {
			hasOnline = true
		}
	}

	if !hasOffline {
		t.Error("offline_trace was not retried after server recovered")
	}
	if !hasOnline {
		t.Error("online_trace was not sent")
	}
}

// 16. Sampling rate=0 drops non-error traces
func TestSamplingRateZeroDrops(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	config := &SDKConfig{
		APIKey:     "proj_key",
		BaseURL:    ts.URL(),
		BufferSize: 1,
		SampleRate: 0,
	}
	monitor := Init(config)
	defer monitor.Close()

	for i := 0; i < 5; i++ {
		monitor.Trace(TraceData{Name: "dropped", TraceType: "test", Status: "success"})
	}

	if ts.RequestCount() != 0 {
		t.Errorf("expected 0 requests with sampleRate=0, got %d", ts.RequestCount())
	}
}

// 17. Sampling rate=1 keeps all traces
func TestSamplingRateOneKeepsAll(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	config := &SDKConfig{
		APIKey:     "proj_key",
		BaseURL:    ts.URL(),
		BufferSize: 1,
		SampleRate: 1.0,
	}
	monitor := Init(config)
	defer monitor.Close()

	for i := 0; i < 5; i++ {
		monitor.Trace(TraceData{Name: "kept", TraceType: "test"})
	}

	if ts.RequestCount() != 5 {
		t.Errorf("expected 5 requests with sampleRate=1, got %d", ts.RequestCount())
	}
}

// 18. Error traces are always captured regardless of sample rate
func TestErrorTracesAlwaysCaptured(t *testing.T) {
	ts := newTestServer(http.StatusOK)
	defer ts.Close()

	config := &SDKConfig{
		APIKey:     "proj_key",
		BaseURL:    ts.URL(),
		BufferSize: 1,
		SampleRate: 0,
	}
	monitor := Init(config)
	defer monitor.Close()

	monitor.Trace(TraceData{Name: "error_trace", TraceType: "test", Status: "error", Error: "critical failure"})

	reqs := ts.Requests()
	if len(reqs) != 1 {
		t.Fatalf("expected 1 request for error trace, got %d", len(reqs))
	}
	if reqs[0].Status != "error" {
		t.Errorf("Status = %q, want error", reqs[0].Status)
	}
	if reqs[0].Error != "critical failure" {
		t.Errorf("Error = %q, want critical failure", reqs[0].Error)
	}
}
