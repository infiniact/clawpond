use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchModelsResult {
    pub models: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestModelResult {
    pub success: bool,
    pub message: Option<String>,
    pub error: Option<String>,
}

/// Resolve provider name → base URL.
fn resolve_base_url(provider: &str, custom_endpoint: &str) -> Option<String> {
    if !custom_endpoint.is_empty() {
        return Some(custom_endpoint.to_string());
    }
    match provider {
        "openai" => Some("https://api.openai.com".to_string()),
        "openrouter" => Some("https://openrouter.ai/api".to_string()),
        "mistral" => Some("https://api.mistral.ai".to_string()),
        "xai" => Some("https://api.x.ai".to_string()),
        "groq" => Some("https://api.groq.com/openai".to_string()),
        "deepseek" => Some("https://api.deepseek.com".to_string()),
        "moonshot" => Some("https://api.moonshot.ai".to_string()),
        "zhipu" => Some("https://open.bigmodel.cn/api/paas/v4".to_string()),
        "zhipu-coding" => Some("https://open.bigmodel.cn/api/coding/paas/v4".to_string()),
        "zhipu-intl" => Some("https://open.z.ai/api/paas/v4".to_string()),
        "zhipu-intl-coding" => Some("https://open.z.ai/api/coding/paas/v4".to_string()),
        "minimax" | "minimax-coding" => Some("https://api.minimax.chat".to_string()),
        "minimax-cn" | "minimax-coding-cn" => Some("https://api.minimaxi.com".to_string()),
        "volcengine" => Some("https://ark.cn-beijing.volces.com/api/v3".to_string()),
        "volcengine-coding" => Some("https://ark.cn-beijing.volces.com/api/coding/v3".to_string()),
        "qwen" => Some("https://dashscope.aliyuncs.com/compatible-mode".to_string()),
        "ollama" => Some("http://127.0.0.1:11434".to_string()),
        "custom" => None,
        _ => None,
    }
}

/// Build a versioned API URL. If the base already ends with a version segment
/// (e.g. /v1, /v3, /v4), append the path directly; otherwise prefix with /v1/.
fn build_api_url(base: &str, path: &str) -> String {
    let base = base.trim_end_matches('/');
    let has_version = base.split('/').last().map_or(false, |seg| {
        seg.len() >= 2 && seg.starts_with('v') && seg[1..].chars().all(|c| c.is_ascii_digit())
    });
    if has_version {
        format!("{}/{}", base, path)
    } else {
        format!("{}/v1/{}", base, path)
    }
}

/// Fetch available models from a provider using their API.
pub fn fetch_models(provider: &str, api_key: &str, custom_endpoint: &str) -> FetchModelsResult {
    match provider {
        "anthropic" => return fetch_anthropic_models(api_key),
        "google" => return fetch_gemini_models(api_key),
        _ => {}
    }

    let base_url = match resolve_base_url(provider, custom_endpoint) {
        Some(url) => url,
        None => {
            return FetchModelsResult {
                models: vec![],
                error: Some(if provider == "custom" {
                    "Custom endpoint is required".into()
                } else {
                    format!("Unknown provider: {}", provider)
                }),
            }
        }
    };

    let prefix = provider.split('-').next().unwrap_or(provider);
    fetch_openai_compatible(&base_url, api_key, prefix)
}

/// Test a model by sending a minimal chat completion request.
pub fn test_model(
    provider: &str,
    api_key: &str,
    custom_endpoint: &str,
    model: &str,
) -> TestModelResult {
    // Extract the model ID (part after "provider/")
    let model_id = if model.contains('/') {
        model.splitn(2, '/').nth(1).unwrap_or(model)
    } else {
        model
    };

    match provider {
        "anthropic" => test_anthropic_model(api_key, model_id),
        "google" => test_google_model(api_key, model_id),
        _ => {
            let base_url = match resolve_base_url(provider, custom_endpoint) {
                Some(url) => url,
                None => {
                    return TestModelResult {
                        success: false,
                        message: None,
                        error: Some("Cannot determine API endpoint".into()),
                    }
                }
            };
            test_openai_compatible_model(&base_url, api_key, model_id)
        }
    }
}

fn read_json(resp: &mut ureq::Body) -> Result<serde_json::Value, String> {
    let buf = resp.read_to_string().map_err(|e| e.to_string())?;
    serde_json::from_str(&buf).map_err(|e| e.to_string())
}

fn extract_model_ids(json: &serde_json::Value, prefix: &str) -> Vec<String> {
    json["data"]
        .as_array()
        .map(|arr: &Vec<serde_json::Value>| {
            arr.iter()
                .filter_map(|m: &serde_json::Value| {
                    m["id"].as_str().map(|s: &str| format!("{}/{}", prefix, s))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

// ── Fetch models ──

fn fetch_openai_compatible(base_url: &str, api_key: &str, provider: &str) -> FetchModelsResult {
    let url = build_api_url(base_url, "models");

    let mut req = ureq::get(&url);
    if !api_key.is_empty() {
        req = req.header("Authorization", &format!("Bearer {}", api_key));
    }

    match req.call() {
        Ok(mut resp) => match read_json(resp.body_mut()) {
            Ok(json) => FetchModelsResult {
                models: extract_model_ids(&json, provider),
                error: None,
            },
            Err(e) => FetchModelsResult {
                models: vec![],
                error: Some(format!("Failed to parse response: {}", e)),
            },
        },
        Err(e) => FetchModelsResult {
            models: vec![],
            error: Some(format!("Request failed: {}", e)),
        },
    }
}

fn fetch_anthropic_models(api_key: &str) -> FetchModelsResult {
    let req = ureq::get("https://api.anthropic.com/v1/models")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01");

    match req.call() {
        Ok(mut resp) => match read_json(resp.body_mut()) {
            Ok(json) => FetchModelsResult {
                models: extract_model_ids(&json, "anthropic"),
                error: None,
            },
            Err(e) => FetchModelsResult {
                models: vec![],
                error: Some(format!("Failed to parse response: {}", e)),
            },
        },
        Err(e) => FetchModelsResult {
            models: vec![],
            error: Some(format!("Request failed: {}", e)),
        },
    }
}

fn fetch_gemini_models(api_key: &str) -> FetchModelsResult {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models?key={}",
        api_key
    );

    match ureq::get(&url).call() {
        Ok(mut resp) => match read_json(resp.body_mut()) {
            Ok(json) => {
                let models = json["models"]
                    .as_array()
                    .map(|arr: &Vec<serde_json::Value>| {
                        arr.iter()
                            .filter_map(|m: &serde_json::Value| {
                                m["name"].as_str().map(|s: &str| {
                                    let name = s.strip_prefix("models/").unwrap_or(s);
                                    format!("google/{}", name)
                                })
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                FetchModelsResult {
                    models,
                    error: None,
                }
            }
            Err(e) => FetchModelsResult {
                models: vec![],
                error: Some(format!("Failed to parse response: {}", e)),
            },
        },
        Err(e) => FetchModelsResult {
            models: vec![],
            error: Some(format!("Request failed: {}", e)),
        },
    }
}

// ── Test model ──

fn test_openai_compatible_model(base_url: &str, api_key: &str, model_id: &str) -> TestModelResult {
    let url = build_api_url(base_url, "chat/completions");

    let body = serde_json::json!({
        "model": model_id,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1,
    });

    let mut req = ureq::post(&url).header("Content-Type", "application/json");
    if !api_key.is_empty() {
        req = req.header("Authorization", &format!("Bearer {}", api_key));
    }

    match req.send_json(&body) {
        Ok(mut resp) => match read_json(resp.body_mut()) {
            Ok(json) => {
                let has_choices = json["choices"].as_array().map_or(false, |a| !a.is_empty());
                if has_choices {
                    TestModelResult {
                        success: true,
                        message: Some("Model responded successfully".into()),
                        error: None,
                    }
                } else {
                    TestModelResult {
                        success: true,
                        message: Some("Got response but no choices returned".into()),
                        error: None,
                    }
                }
            }
            Err(e) => TestModelResult {
                success: false,
                message: None,
                error: Some(format!("Failed to parse response: {}", e)),
            },
        },
        Err(e) => TestModelResult {
            success: false,
            message: None,
            error: Some(format!("Request failed: {}", e)),
        },
    }
}

fn test_anthropic_model(api_key: &str, model_id: &str) -> TestModelResult {
    let body = serde_json::json!({
        "model": model_id,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1,
    });

    let req = ureq::post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json");

    match req.send_json(&body) {
        Ok(mut resp) => match read_json(resp.body_mut()) {
            Ok(json) => {
                if json["id"].as_str().is_some() {
                    TestModelResult {
                        success: true,
                        message: Some("Model responded successfully".into()),
                        error: None,
                    }
                } else {
                    TestModelResult {
                        success: false,
                        message: None,
                        error: Some("Unexpected response format".into()),
                    }
                }
            }
            Err(e) => TestModelResult {
                success: false,
                message: None,
                error: Some(format!("Failed to parse response: {}", e)),
            },
        },
        Err(e) => TestModelResult {
            success: false,
            message: None,
            error: Some(format!("Request failed: {}", e)),
        },
    }
}

fn test_google_model(api_key: &str, model_id: &str) -> TestModelResult {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model_id, api_key
    );

    let body = serde_json::json!({
        "contents": [{"parts": [{"text": "hi"}]}],
        "generationConfig": {"maxOutputTokens": 1},
    });

    match ureq::post(&url)
        .header("Content-Type", "application/json")
        .send_json(&body)
    {
        Ok(mut resp) => match read_json(resp.body_mut()) {
            Ok(json) => {
                if json["candidates"].as_array().map_or(false, |a| !a.is_empty()) {
                    TestModelResult {
                        success: true,
                        message: Some("Model responded successfully".into()),
                        error: None,
                    }
                } else {
                    TestModelResult {
                        success: false,
                        message: None,
                        error: Some("No candidates returned".into()),
                    }
                }
            }
            Err(e) => TestModelResult {
                success: false,
                message: None,
                error: Some(format!("Failed to parse response: {}", e)),
            },
        },
        Err(e) => TestModelResult {
            success: false,
            message: None,
            error: Some(format!("Request failed: {}", e)),
        },
    }
}
