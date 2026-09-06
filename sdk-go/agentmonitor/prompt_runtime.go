package agentmonitor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// PromptEnvironment 限定 Runtime 支持的环境名。
type PromptEnvironment string

const (
	PromptEnvProduction  PromptEnvironment = "production"
	PromptEnvStaging     PromptEnvironment = "staging"
	PromptEnvDevelopment PromptEnvironment = "development"
)

// ResolvedPrompt 是 Runtime API 返回的已发布 Prompt 内容。
type ResolvedPrompt struct {
	PromptID        string                 `json:"promptId"`
	PromptName      string                 `json:"promptName"`
	PromptVersionID string                 `json:"promptVersionId"`
	VersionNumber   int                    `json:"versionNumber"`
	Environment     string                 `json:"environment"`
	Content         string                 `json:"content"`
	VariablesSchema map[string]interface{} `json:"variablesSchema"`
	ModelDefaults   map[string]interface{} `json:"modelDefaults"`
	ETag            string                 `json:"etag"`
	DeployedAt      string                 `json:"deployedAt"`
}

// GetPromptOptions 控制单次 Get 调用的缓存行为。
type GetPromptOptions struct {
	Environment  PromptEnvironment
	MaxAge       time.Duration
	ForceRefresh bool
}

type promptCacheEntry struct {
	prompt   ResolvedPrompt
	cachedAt time.Time
}

// PromptRuntimeClient 调用后端 Runtime API，并维护 ETag/TTL 缓存。
type PromptRuntimeClient struct {
	baseURL        string
	apiKey         string
	projectID      string
	defaultMaxAge  time.Duration
	httpClient     *http.Client
	cache          map[string]promptCacheEntry
	mu             sync.RWMutex
}

// NewPromptRuntimeClient 构造一个 PromptRuntimeClient。
//   - baseURL 必填，例如 https://agentmonitor.example.com
//   - apiKey 必填（JWT 或 amt_ Service Token）
//   - projectID 必填
//   - defaultMaxAge 为 0 时默认 60 秒
//   - httpClient 为 nil 时使用 http.DefaultClient
func NewPromptRuntimeClient(baseURL, apiKey, projectID string, defaultMaxAge time.Duration, httpClient *http.Client) *PromptRuntimeClient {
	if defaultMaxAge <= 0 {
		defaultMaxAge = 60 * time.Second
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &PromptRuntimeClient{
		baseURL:       strings.TrimRight(baseURL, "/"),
		apiKey:        apiKey,
		projectID:     projectID,
		defaultMaxAge: defaultMaxAge,
		httpClient:    httpClient,
		cache:         make(map[string]promptCacheEntry),
	}
}

func (c *PromptRuntimeClient) cacheKey(promptName string, env PromptEnvironment) string {
	return fmt.Sprintf("%s::%s::%s", c.projectID, env, promptName)
}

// Get 按名称解析一个已发布的 Prompt。
//
// 行为：
//  1. TTL 内的缓存直接返回（除非 ForceRefresh）
//  2. 过期后带 If-None-Match 协商，命中 304 延长缓存寿命
//  3. 200 时覆盖缓存；非 2xx/304 返回错误
func (c *PromptRuntimeClient) Get(ctx context.Context, promptName string, opts *GetPromptOptions) (*ResolvedPrompt, error) {
	env := PromptEnvProduction
	maxAge := c.defaultMaxAge
	forceRefresh := false
	if opts != nil {
		if opts.Environment != "" {
			env = opts.Environment
		}
		if opts.MaxAge > 0 {
			maxAge = opts.MaxAge
		}
		forceRefresh = opts.ForceRefresh
	}

	key := c.cacheKey(promptName, env)
	now := time.Now()

	if !forceRefresh {
		c.mu.RLock()
		existing, ok := c.cache[key]
		c.mu.RUnlock()
		if ok && now.Sub(existing.cachedAt) < maxAge {
			p := existing.prompt
			return &p, nil
		}
	}

	// 构造 URL
	qs := url.Values{}
	qs.Set("projectId", c.projectID)
	qs.Set("environment", string(env))
	endpoint := fmt.Sprintf("%s/api/v2/runtime/prompts/%s?%s",
		c.baseURL, url.PathEscape(promptName), qs.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build runtime request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	var existingETag string
	c.mu.RLock()
	if existing, ok := c.cache[key]; ok {
		existingETag = existing.prompt.ETag
	}
	c.mu.RUnlock()
	if existingETag != "" {
		req.Header.Set("If-None-Match", existingETag)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("prompt runtime request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		c.mu.RLock()
		existing, ok := c.cache[key]
		c.mu.RUnlock()
		if !ok {
			return nil, errors.New("received 304 without prior cache entry")
		}
		c.mu.Lock()
		c.cache[key] = promptCacheEntry{prompt: existing.prompt, cachedAt: time.Now()}
		c.mu.Unlock()
		p := existing.prompt
		return &p, nil
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("prompt runtime %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var prompt ResolvedPrompt
	if err := json.NewDecoder(resp.Body).Decode(&prompt); err != nil {
		return nil, fmt.Errorf("decode runtime response: %w", err)
	}
	// 后端可能不在 header 里回 ETag（JSON 已含 etag 字段），以 body 为准
	if respETag := resp.Header.Get("ETag"); respETag != "" && prompt.ETag == "" {
		prompt.ETag = respETag
	}
	c.mu.Lock()
	c.cache[key] = promptCacheEntry{prompt: prompt, cachedAt: time.Now()}
	c.mu.Unlock()
	return &prompt, nil
}

// ClearCache 清空全部缓存。
func (c *PromptRuntimeClient) ClearCache() {
	c.mu.Lock()
	c.cache = make(map[string]promptCacheEntry)
	c.mu.Unlock()
}

// CacheSize 返回当前缓存条目数（可观测性）。
func (c *PromptRuntimeClient) CacheSize() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.cache)
}
