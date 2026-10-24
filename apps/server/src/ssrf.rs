//! SSRF 防护（需求 §9.2，M3.7 提前实现校验函数；URL 导入 P1 启用）。
//!
//! NAS 代表用户访问 URL 前必须调用 [`assert_allowed_url`]：
//! - 只允许 http/https；
//! - 拒绝 loopback / 私有网段 / 链路本地 / 组播 / 未指定地址；
//! - 域名解析后的**每一个** IP 都必须通过校验（防 DNS rebinding 的第一道闸，
//!   P1 接入重定向后还需在每次重定向后重新校验）。

use std::net::{IpAddr, ToSocketAddrs};

pub fn assert_allowed_url(raw: &str) -> Result<(), String> {
    let url = url::Url::parse(raw).map_err(|e| format!("invalid url: {e}"))?;
    match url.scheme() {
        "http" | "https" => {}
        other => return Err(format!("scheme not allowed: {other}")),
    }
    let host = url
        .host_str()
        .ok_or_else(|| "url has no host".to_string())?;
    match url.host() {
        Some(url::Host::Domain(_)) => {
            let addrs = (host, 0)
                .to_socket_addrs()
                .map_err(|e| format!("dns resolve failed: {e}"))?
                .collect::<Vec<_>>();
            if addrs.is_empty() {
                return Err("dns resolved to nothing".into());
            }
            for a in addrs {
                check_ip(a.ip())?;
            }
            Ok(())
        }
        Some(url::Host::Ipv4(ip)) => check_ip(IpAddr::V4(ip)),
        Some(url::Host::Ipv6(ip)) => check_ip(IpAddr::V6(ip)),
        None => Err("url has no host".into()),
    }
}

fn check_ip(ip: IpAddr) -> Result<(), String> {
    let bad = match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_unspecified()
                || v4.is_broadcast()
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6.is_unspecified()
                || v6.is_multicast()
        }
    };
    if bad {
        Err(format!("target address not allowed: {ip}"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 用 IP 字面量避免测试依赖 DNS（域名用例在真实环境人工验证）
    #[test]
    fn rejects_internal_targets() {
        for url in [
            "http://127.0.0.1/x",
            "http://10.0.0.1/x",
            "http://172.16.0.1/x",
            "http://192.168.1.1/x",
            "http://169.254.169.254/latest/meta-data", // 云元数据
            "http://0.0.0.0/x",
            "http://[::1]/x",
            "http://[fe80::1]/x",
            "file:///etc/passwd",
            "ftp://93.184.216.34/x",
        ] {
            assert!(assert_allowed_url(url).is_err(), "should reject {url}");
        }
    }

    #[test]
    fn allows_public_ip_literal() {
        assert!(assert_allowed_url("http://93.184.216.34/x").is_ok());
        assert!(assert_allowed_url("https://93.184.216.34:8443/x").is_ok());
    }
}
