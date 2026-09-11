use serde_json::{json, Value};
use std::path::Path;

pub fn normalize(value: &Value) -> Result<Value, String> {
    let kind = value["kind"].as_str().ok_or("连接方式无效")?;
    if !matches!(kind, "ssh" | "https" | "portal") {
        return Err("连接方式无效".into());
    }
    let address = value["address"].as_str().ok_or("连接地址无效")?.trim();
    if address.is_empty() || address.len() > 2048 || address.chars().any(char::is_control) {
        return Err("连接地址无效".into());
    }
    let canonical_address;
    if kind == "ssh" {
        if address.len() > 255
            || address.starts_with('-')
            || !address
                .chars()
                .all(|c| c.is_alphanumeric() || "_.@:[\u{005d}%+-".contains(c))
        {
            return Err("请输入 SSH 主机名、IP 或 user@host，不要填写命令".into());
        }
        canonical_address = address.to_owned();
    } else {
        let url = tauri::Url::parse(address).map_err(|_| "服务地址无效")?;
        let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if !(url.scheme() == "https" || (url.scheme() == "http" && local))
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("请输入 HTTPS 服务地址，HTTP 仅允许本机隧道地址".into());
        }
        canonical_address = url.origin().ascii_serialization();
    }
    let name = value["name"].as_str().unwrap_or("").trim();
    if name.chars().count() > 100 || name.chars().any(char::is_control) {
        return Err("设备名称无效".into());
    }
    let port = &value["port"];
    if !port.is_null()
        && !port
            .as_u64()
            .is_some_and(|port| (1..=65535).contains(&port))
    {
        return Err("服务端口无效".into());
    }
    let platform = value["platform"].as_str().unwrap_or("auto");
    if !matches!(platform, "auto" | "posix" | "windows") {
        return Err("远端系统无效".into());
    }
    let instance = value["instanceId"].as_str().unwrap_or("");
    if instance.len() > 2048 || instance.chars().any(char::is_control) {
        return Err("设备标识无效".into());
    }
    Ok(
        json!({"kind":kind,"address":canonical_address,"name":name,"port":port,
        "platform":platform,"instanceId":instance,"allowStart":value["allowStart"] == true}),
    )
}

pub fn read(path: &Path) -> Result<Vec<Value>, String> {
    let metadata = match std::fs::metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(format!("无法读取连接记录：{error}")),
    };
    if metadata.len() > 65536 {
        return Err("连接记录过大，未覆盖原文件".into());
    }
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    let entries: Vec<Value> =
        serde_json::from_slice(&bytes).map_err(|_| "连接记录格式无效，未覆盖原文件")?;
    if entries.len() > 12 {
        return Err("连接记录数量无效".into());
    }
    entries.iter().map(normalize).collect()
}

// Caller serializes writes. Never replace a damaged preference file with an empty list.
pub fn write(path: &Path, entries: &[Value]) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("连接记录路径无效")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("pending");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| format!("无法保存连接记录：{error}"))?;
    let result = (|| {
        file.write_all(&serde_json::to_vec(entries).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        std::fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preferences_keep_identity_without_opaque_commands() {
        let result = normalize(&json!({"kind":"ssh","address":" user@host ","instanceId":"identity-1","password":"private","command":"rm -rf"})).unwrap();
        assert_eq!(result["address"], "user@host");
        assert_eq!(result["instanceId"], "identity-1");
        assert!(result.get("password").is_none());
        assert!(result.get("command").is_none());
        assert!(normalize(&json!({"kind":"ssh","address":"host","port":0})).is_err());
        assert!(normalize(&json!({"kind":"exec","address":"host"})).is_err());
        assert!(normalize(&json!({"kind":"ssh","address":"--proxy-command=whoami"})).is_err());
        assert!(normalize(&json!({"kind":"https","address":"http://192.168.1.1"})).is_err());
        assert!(
            normalize(&json!({"kind":"https","address":"https://user:password@example.com"}))
                .is_err()
        );
        assert!(normalize(&json!({"kind":"https","address":"https://example.com/path"})).is_err());
        assert_eq!(
            normalize(&json!({"kind":"https","address":"http://127.0.0.1:49389/"})).unwrap()
                ["address"],
            "http://127.0.0.1:49389"
        );
    }
    #[test]
    fn preferences_replace_atomically_and_refuse_corrupt_sources() {
        let root = std::env::temp_dir().join(format!(
            "takeboard-pref-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let file = root.join("remote-connections.json");
        assert!(read(&file).unwrap().is_empty());
        let entry =
            normalize(&json!({"kind":"ssh","address":"host","instanceId":"original"})).unwrap();
        write(&file, &[entry.clone()]).unwrap();
        assert_eq!(read(&file).unwrap(), vec![entry]);
        write(&file, &[]).unwrap();
        assert!(read(&file).unwrap().is_empty());
        std::fs::write(&file, b"broken").unwrap();
        assert!(read(&file).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), b"broken");
        std::fs::remove_dir_all(root).unwrap();
    }
}
