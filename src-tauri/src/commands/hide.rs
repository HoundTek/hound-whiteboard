//! 隐藏文件操作（跨平台）
//!
//! - Windows：设置 FILE_ATTRIBUTE_HIDDEN 属性（路径不变）
//! - Unix/macOS：重命名加 "." 前缀（路径变化，调用方需用返回的新路径）

use std::path::Path;

/// 设置或清除 Windows 隐藏属性
#[cfg(windows)]
fn set_hidden_attr(p: &Path, hidden: bool) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, INVALID_FILE_ATTRIBUTES,
    };

    let wide: Vec<u16> = p
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let attrs = unsafe { GetFileAttributesW(wide.as_ptr()) };
    if attrs == INVALID_FILE_ATTRIBUTES {
        return Err("GetFileAttributesW failed".into());
    }

    let new_attrs = if hidden {
        attrs | FILE_ATTRIBUTE_HIDDEN
    } else {
        attrs & !FILE_ATTRIBUTE_HIDDEN
    };

    let ok = unsafe { SetFileAttributesW(wide.as_ptr(), new_attrs) };
    if ok == 0 {
        return Err("SetFileAttributesW failed".into());
    }
    Ok(())
}

/// 隐藏路径
///
/// 返回 Some(新路径) 表示发生了重命名（Unix 语义），None 表示路径未变（Windows 语义）。
pub fn hide_path(p: &Path) -> Result<Option<std::path::PathBuf>, String> {
    #[cfg(windows)]
    {
        set_hidden_attr(p, true)?;
        return Ok(None);
    }

    #[cfg(not(windows))]
    {
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "invalid file name".to_string())?;
        if name.starts_with('.') {
            return Ok(None);
        }
        let new_path = p.with_file_name(format!(".{name}"));
        std::fs::rename(p, &new_path).map_err(|e| format!("hide rename failed: {e}"))?;
        Ok(Some(new_path))
    }
}

/// 取消隐藏路径
///
/// 返回 Some(新路径) 表示发生了重命名，None 表示路径未变。
pub fn unhide_path(p: &Path) -> Result<Option<std::path::PathBuf>, String> {
    #[cfg(windows)]
    {
        set_hidden_attr(p, false)?;
        return Ok(None);
    }

    #[cfg(not(windows))]
    {
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "invalid file name".to_string())?;
        if !name.starts_with('.') {
            return Ok(None);
        }
        let new_path = p.with_file_name(name.trim_start_matches('.'));
        std::fs::rename(p, &new_path).map_err(|e| format!("unhide rename failed: {e}"))?;
        Ok(Some(new_path))
    }
}

/// 检查路径是否隐藏
pub fn is_hidden(p: &Path) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, INVALID_FILE_ATTRIBUTES,
        };

        let wide: Vec<u16> = p
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let attrs = unsafe { GetFileAttributesW(wide.as_ptr()) };
        if attrs == INVALID_FILE_ATTRIBUTES {
            return Err("GetFileAttributesW failed".into());
        }
        Ok(attrs & FILE_ATTRIBUTE_HIDDEN != 0)
    }

    #[cfg(not(windows))]
    {
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "invalid file name".to_string())?;
        Ok(name.starts_with('.'))
    }
}
