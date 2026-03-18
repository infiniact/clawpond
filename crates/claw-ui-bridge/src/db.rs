use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub fn open_or_create() -> Result<Connection> {
    let db_path = db_path();
    if let Some(parent) = db_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(&db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;
    migrate(&conn)?;
    Ok(conn)
}

fn db_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".openclaw")
        .join("clawpond.db")
}

fn migrate(conn: &Connection) -> Result<()> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS gateways (
                id TEXT PRIMARY KEY,
                name TEXT,
                emoji TEXT,
                type TEXT DEFAULT 'docker',
                root_dir TEXT,
                configured INTEGER DEFAULT 0,
                sort_order INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS agent_icons (
                key TEXT PRIMARY KEY,
                emoji TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT NOT NULL,
                root_dir TEXT NOT NULL,
                role TEXT,
                content TEXT,
                timestamp TEXT,
                tool_name TEXT,
                tool_status TEXT,
                source_gw_id TEXT,
                source_gw_name TEXT,
                source_gw_emoji TEXT,
                mentions TEXT,
                agent_name TEXT,
                PRIMARY KEY (root_dir, id)
            );

            CREATE INDEX IF NOT EXISTS idx_chat_ts ON chat_messages(root_dir, timestamp);

            CREATE TABLE IF NOT EXISTS token_usage (
                gateway_id TEXT,
                hour_key TEXT,
                tokens INTEGER DEFAULT 0,
                PRIMARY KEY (gateway_id, hour_key)
            );

            PRAGMA user_version = 1;",
        )?;
    }
    let _ = version; // suppress warning about unused after migration
    Ok(())
}

// ── Settings ──

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare_cached("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
}

pub fn delete_setting(conn: &Connection, key: &str) -> Result<()> {
    conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
    Ok(())
}

// ── Gateways ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoredGateway {
    pub id: String,
    pub name: String,
    pub emoji: String,
    #[serde(rename = "type")]
    pub gw_type: String,
    #[serde(rename = "rootDir")]
    pub root_dir: Option<String>,
    pub configured: bool,
}

pub fn load_gateways(conn: &Connection) -> Result<Vec<StoredGateway>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, name, emoji, type, root_dir, configured FROM gateways ORDER BY sort_order, rowid",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(StoredGateway {
            id: row.get(0)?,
            name: row.get(1)?,
            emoji: row.get(2)?,
            gw_type: row.get::<_, String>(3)?,
            root_dir: row.get(4)?,
            configured: row.get::<_, i32>(5)? != 0,
        })
    })?;
    rows.collect()
}

pub fn save_gateways(conn: &Connection, gateways: &[StoredGateway]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch("DELETE FROM gateways")?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO gateways (id, name, emoji, type, root_dir, configured, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for (i, gw) in gateways.iter().enumerate() {
            stmt.execute(params![
                gw.id,
                gw.name,
                gw.emoji,
                gw.gw_type,
                gw.root_dir,
                gw.configured as i32,
                i as i32,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

// ── Agent Icons ──

pub fn load_agent_icons(conn: &Connection) -> Result<HashMap<String, String>> {
    let mut stmt = conn.prepare_cached("SELECT key, emoji FROM agent_icons")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut map = HashMap::new();
    for r in rows {
        let (k, v) = r?;
        map.insert(k, v);
    }
    Ok(map)
}

pub fn save_agent_icons(conn: &Connection, icons: &HashMap<String, String>) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch("DELETE FROM agent_icons")?;
    {
        let mut stmt =
            tx.prepare_cached("INSERT INTO agent_icons (key, emoji) VALUES (?1, ?2)")?;
        for (k, v) in icons {
            stmt.execute(params![k, v])?;
        }
    }
    tx.commit()?;
    Ok(())
}

// ── Chat Messages ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<ChatTool>,
    #[serde(rename = "sourceGateway", skip_serializing_if = "Option::is_none")]
    pub source_gateway: Option<ChatSourceGateway>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mentions: Option<Vec<String>>,
    #[serde(rename = "agentName", skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatTool {
    pub name: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatSourceGateway {
    pub id: String,
    pub name: String,
    pub emoji: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoadMessagesResult {
    pub messages: Vec<ChatMessage>,
    #[serde(rename = "hasMore")]
    pub has_more: bool,
}

pub fn load_messages(
    conn: &Connection,
    root_dir: &str,
    offset: i64,
    limit: i64,
) -> Result<LoadMessagesResult> {
    // Count total messages for this root_dir
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chat_messages WHERE root_dir = ?1",
        params![root_dir],
        |row| row.get(0),
    )?;

    // We want the most recent `limit` messages, skipping `offset` from the end
    let end = total - offset;
    let start = std::cmp::max(0, end - limit);
    if end <= 0 {
        return Ok(LoadMessagesResult {
            messages: vec![],
            has_more: false,
        });
    }

    let mut stmt = conn.prepare_cached(
        "SELECT id, role, content, timestamp, tool_name, tool_status,
                source_gw_id, source_gw_name, source_gw_emoji,
                mentions, agent_name
         FROM chat_messages
         WHERE root_dir = ?1
         ORDER BY timestamp ASC, rowid ASC
         LIMIT ?2 OFFSET ?3",
    )?;

    let rows = stmt.query_map(params![root_dir, end - start, start], |row| {
        let tool_name: Option<String> = row.get(4)?;
        let tool_status: Option<String> = row.get(5)?;
        let src_id: Option<String> = row.get(6)?;
        let src_name: Option<String> = row.get(7)?;
        let src_emoji: Option<String> = row.get(8)?;
        let mentions_json: Option<String> = row.get(9)?;

        let tool = match (tool_name, tool_status) {
            (Some(name), Some(status)) => Some(ChatTool { name, status }),
            _ => None,
        };
        let source_gateway = match (src_id, src_name, src_emoji) {
            (Some(id), Some(name), Some(emoji)) => Some(ChatSourceGateway { id, name, emoji }),
            _ => None,
        };
        let mentions: Option<Vec<String>> = mentions_json
            .and_then(|j| serde_json::from_str(&j).ok());

        Ok(ChatMessage {
            id: row.get(0)?,
            role: row.get(1)?,
            content: row.get(2)?,
            timestamp: row.get(3)?,
            tool,
            source_gateway,
            mentions,
            agent_name: row.get(10)?,
        })
    })?;

    let messages: Vec<ChatMessage> = rows.collect::<Result<_>>()?;

    Ok(LoadMessagesResult {
        messages,
        has_more: start > 0,
    })
}

pub fn append_messages(conn: &Connection, root_dir: &str, msgs: &[ChatMessage]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT OR IGNORE INTO chat_messages
             (id, root_dir, role, content, timestamp, tool_name, tool_status,
              source_gw_id, source_gw_name, source_gw_emoji, mentions, agent_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )?;
        for m in msgs {
            let mentions_json = m.mentions.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default());
            stmt.execute(params![
                m.id,
                root_dir,
                m.role,
                m.content,
                m.timestamp,
                m.tool.as_ref().map(|t| &t.name),
                m.tool.as_ref().map(|t| &t.status),
                m.source_gateway.as_ref().map(|s| &s.id),
                m.source_gateway.as_ref().map(|s| &s.name),
                m.source_gateway.as_ref().map(|s| &s.emoji),
                mentions_json,
                m.agent_name,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn update_message(
    conn: &Connection,
    root_dir: &str,
    id: &str,
    updates: &ChatMessage,
) -> Result<()> {
    let mentions_json = updates
        .mentions
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_default());
    conn.execute(
        "UPDATE chat_messages SET role = ?1, content = ?2, timestamp = ?3,
         tool_name = ?4, tool_status = ?5,
         source_gw_id = ?6, source_gw_name = ?7, source_gw_emoji = ?8,
         mentions = ?9, agent_name = ?10
         WHERE root_dir = ?11 AND id = ?12",
        params![
            updates.role,
            updates.content,
            updates.timestamp,
            updates.tool.as_ref().map(|t| &t.name),
            updates.tool.as_ref().map(|t| &t.status),
            updates.source_gateway.as_ref().map(|s| &s.id),
            updates.source_gateway.as_ref().map(|s| &s.name),
            updates.source_gateway.as_ref().map(|s| &s.emoji),
            mentions_json,
            updates.agent_name,
            root_dir,
            id,
        ],
    )?;
    Ok(())
}

pub fn save_all_messages(conn: &Connection, root_dir: &str, msgs: &[ChatMessage]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM chat_messages WHERE root_dir = ?1",
        params![root_dir],
    )?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO chat_messages
             (id, root_dir, role, content, timestamp, tool_name, tool_status,
              source_gw_id, source_gw_name, source_gw_emoji, mentions, agent_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )?;
        for m in msgs {
            let mentions_json = m.mentions.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default());
            stmt.execute(params![
                m.id,
                root_dir,
                m.role,
                m.content,
                m.timestamp,
                m.tool.as_ref().map(|t| &t.name),
                m.tool.as_ref().map(|t| &t.status),
                m.source_gateway.as_ref().map(|s| &s.id),
                m.source_gateway.as_ref().map(|s| &s.name),
                m.source_gateway.as_ref().map(|s| &s.emoji),
                mentions_json,
                m.agent_name,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Merge chat messages from one root_dir into another.
/// Copies messages (INSERT OR IGNORE to skip duplicates), then deletes the source.
pub fn merge_messages(conn: &Connection, from_root_dir: &str, to_root_dir: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO chat_messages
         (id, root_dir, role, content, timestamp, tool_name, tool_status,
          source_gw_id, source_gw_name, source_gw_emoji, mentions, agent_name)
         SELECT id, ?2, role, content, timestamp, tool_name, tool_status,
                source_gw_id, source_gw_name, source_gw_emoji, mentions, agent_name
         FROM chat_messages WHERE root_dir = ?1",
        params![from_root_dir, to_root_dir],
    )?;
    tx.execute(
        "DELETE FROM chat_messages WHERE root_dir = ?1",
        params![from_root_dir],
    )?;
    tx.commit()?;
    Ok(())
}

// ── Token Usage ──

#[derive(Debug, Serialize, Deserialize)]
pub struct DayUsage {
    pub date: String,
    pub tokens: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HourUsage {
    pub hour: i32,
    pub tokens: i64,
}

pub fn record_usage(conn: &Connection, gateway_id: &str, tokens: i64) -> Result<()> {
    let now = chrono_hour_key();
    conn.execute(
        "INSERT INTO token_usage (gateway_id, hour_key, tokens) VALUES (?1, ?2, ?3)
         ON CONFLICT(gateway_id, hour_key) DO UPDATE SET tokens = tokens + ?3",
        params![gateway_id, now, tokens],
    )?;
    Ok(())
}

pub fn get_daily_usage(conn: &Connection, gateway_id: &str, days: i32) -> Result<Vec<DayUsage>> {
    let now = now_local();
    let mut result = Vec::new();
    for i in (1..=days).rev() {
        let d = now - std::time::Duration::from_secs(i as u64 * 86400);
        let dk = format_day(&d);
        let prefix = format!("{}-", dk);
        let total: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(tokens), 0) FROM token_usage WHERE gateway_id = ?1 AND hour_key LIKE ?2",
                params![gateway_id, format!("{}%", prefix)],
                |row| row.get(0),
            )
            .unwrap_or(0);
        result.push(DayUsage {
            date: dk,
            tokens: total,
        });
    }
    Ok(result)
}

pub fn get_today_hourly_usage(conn: &Connection, gateway_id: &str) -> Result<Vec<HourUsage>> {
    let now = now_local();
    let dk = format_day(&now);
    let mut result = Vec::new();
    for h in 0..24 {
        let hk = format!("{}-{:02}", dk, h);
        let tokens: i64 = conn
            .query_row(
                "SELECT COALESCE(tokens, 0) FROM token_usage WHERE gateway_id = ?1 AND hour_key = ?2",
                params![gateway_id, hk],
                |row| row.get(0),
            )
            .unwrap_or(0);
        result.push(HourUsage { hour: h, tokens });
    }
    Ok(result)
}

pub fn persist_usage_bulk(
    conn: &Connection,
    gateway_id: &str,
    hour_totals: &HashMap<String, i64>,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO token_usage (gateway_id, hour_key, tokens) VALUES (?1, ?2, ?3)
             ON CONFLICT(gateway_id, hour_key) DO UPDATE SET tokens = MAX(tokens, ?3)",
        )?;
        for (hk, tokens) in hour_totals {
            stmt.execute(params![gateway_id, hk, tokens])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn prune_old_usage(conn: &Connection) -> Result<()> {
    let now = now_local();
    let cutoff = now - std::time::Duration::from_secs(30 * 86400);
    let cutoff_key = format_day(&cutoff);
    conn.execute(
        "DELETE FROM token_usage WHERE hour_key < ?1",
        params![cutoff_key],
    )?;
    Ok(())
}

// ── Migration ──

#[derive(Debug, Deserialize)]
pub struct MigrationPayload {
    pub settings: Option<HashMap<String, String>>,
    pub gateways: Option<Vec<StoredGateway>>,
    pub agent_icons: Option<HashMap<String, String>>,
    pub chat_messages: Option<HashMap<String, Vec<ChatMessage>>>,
    pub token_usage: Option<HashMap<String, HashMap<String, i64>>>,
}

pub fn migrate_from_payload(conn: &Connection, payload: &MigrationPayload) -> Result<()> {
    let tx = conn.unchecked_transaction()?;

    if let Some(ref settings) = payload.settings {
        let mut stmt = tx.prepare_cached(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        )?;
        for (k, v) in settings {
            stmt.execute(params![k, v])?;
        }
    }

    if let Some(ref gateways) = payload.gateways {
        tx.execute_batch("DELETE FROM gateways")?;
        let mut stmt = tx.prepare_cached(
            "INSERT INTO gateways (id, name, emoji, type, root_dir, configured, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for (i, gw) in gateways.iter().enumerate() {
            stmt.execute(params![
                gw.id,
                gw.name,
                gw.emoji,
                gw.gw_type,
                gw.root_dir,
                gw.configured as i32,
                i as i32,
            ])?;
        }
    }

    if let Some(ref icons) = payload.agent_icons {
        tx.execute_batch("DELETE FROM agent_icons")?;
        let mut stmt =
            tx.prepare_cached("INSERT INTO agent_icons (key, emoji) VALUES (?1, ?2)")?;
        for (k, v) in icons {
            stmt.execute(params![k, v])?;
        }
    }

    if let Some(ref chat_map) = payload.chat_messages {
        let mut stmt = tx.prepare_cached(
            "INSERT OR IGNORE INTO chat_messages
             (id, root_dir, role, content, timestamp, tool_name, tool_status,
              source_gw_id, source_gw_name, source_gw_emoji, mentions, agent_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )?;
        for (root_dir, msgs) in chat_map {
            for m in msgs {
                let mentions_json = m.mentions.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default());
                stmt.execute(params![
                    m.id,
                    root_dir,
                    m.role,
                    m.content,
                    m.timestamp,
                    m.tool.as_ref().map(|t| &t.name),
                    m.tool.as_ref().map(|t| &t.status),
                    m.source_gateway.as_ref().map(|s| &s.id),
                    m.source_gateway.as_ref().map(|s| &s.name),
                    m.source_gateway.as_ref().map(|s| &s.emoji),
                    mentions_json,
                    m.agent_name,
                ])?;
            }
        }
    }

    if let Some(ref usage_map) = payload.token_usage {
        let mut stmt = tx.prepare_cached(
            "INSERT OR REPLACE INTO token_usage (gateway_id, hour_key, tokens) VALUES (?1, ?2, ?3)",
        )?;
        for (gw_id, hours) in usage_map {
            for (hk, tokens) in hours {
                stmt.execute(params![gw_id, hk, tokens])?;
            }
        }
    }

    tx.commit()?;
    Ok(())
}

// ── Time helpers ──

fn now_local() -> std::time::SystemTime {
    std::time::SystemTime::now()
}

#[cfg(unix)]
extern "C" {
    fn localtime_r(timep: *const i64, result: *mut Tm) -> *mut Tm;
}

#[cfg(unix)]
#[repr(C)]
#[allow(non_camel_case_types)]
struct Tm {
    tm_sec: i32,
    tm_min: i32,
    tm_hour: i32,
    tm_mday: i32,
    tm_mon: i32,
    tm_year: i32,
    tm_wday: i32,
    tm_yday: i32,
    tm_isdst: i32,
    tm_gmtoff: i64,
    tm_zone: *const std::ffi::c_char,
}

fn system_time_to_tm(t: &std::time::SystemTime) -> (i32, u32, u32, u32) {
    let duration = t
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs() as i64;

    #[cfg(unix)]
    {
        let mut tm = std::mem::MaybeUninit::<Tm>::zeroed();
        unsafe { localtime_r(&secs, tm.as_mut_ptr()) };
        let tm = unsafe { tm.assume_init() };
        (
            tm.tm_year + 1900,
            (tm.tm_mon + 1) as u32,
            tm.tm_mday as u32,
            tm.tm_hour as u32,
        )
    }
    #[cfg(not(unix))]
    {
        // UTC fallback on non-unix
        let total_days = secs / 86400;
        let time_of_day = secs % 86400;
        let hour = (time_of_day / 3600) as u32;

        let mut days = total_days + 719468;
        let era = days / 146097;
        let doe = days - era * 146097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = if m <= 2 { y + 1 } else { y };
        (y as i32, m as u32, d as u32, hour)
    }
}

fn format_day(t: &std::time::SystemTime) -> String {
    let (y, m, d, _) = system_time_to_tm(t);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

fn chrono_hour_key() -> String {
    let now = now_local();
    let (y, m, d, h) = system_time_to_tm(&now);
    format!("{:04}-{:02}-{:02}-{:02}", y, m, d, h)
}
