use napi::Result;
use napi_derive::napi;

/// Point 的 JSON 表示
#[napi(object)]
pub struct PointJSON {
    pub x: f64,
    pub y: f64,
}

/// 二维点类
#[napi]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl std::ops::Add for &Point {
    type Output = Point;

    fn add(self, other: &Point) -> Point {
        Point {
            x: self.x + other.x,
            y: self.y + other.y,
        }
    }
}

impl std::ops::Sub for &Point {
    type Output = Point;

    fn sub(self, other: &Point) -> Point {
        Point {
            x: self.x - other.x,
            y: self.y - other.y,
        }
    }
}

impl PartialEq for &Point {
    fn eq(&self, other: &Self) -> bool {
        self.x == other.x && self.y == other.y
    }
}

#[napi]
impl Point {
    /// 创建新的点
    #[napi(constructor)]
    pub fn new(x: f64, y: f64) -> Self {
        Point { x, y }
    }

    /// 获取 x 坐标
    #[napi(getter)]
    pub fn get_x(&self) -> f64 {
        self.x
    }

    /// 设置 x 坐标
    #[napi(setter)]
    pub fn set_x(&mut self, x: f64) {
        self.x = x;
    }

    /// 获取 y 坐标
    #[napi(getter)]
    pub fn get_y(&self) -> f64 {
        self.y
    }

    /// 设置 y 坐标
    #[napi(setter)]
    pub fn set_y(&mut self, y: f64) {
        self.y = y;
    }

    /// 计算到另一个点的距离
    #[napi]
    pub fn distance_to(&self, other: &Point) -> f64 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        (dx * dx + dy * dy).sqrt()
    }

    /// 计算到另一个点的距离的平方
    #[napi]
    pub fn distance_sq(&self, other: &Point) -> f64 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        dx * dx + dy * dy
    }

    /// 克隆点
    #[napi]
    pub fn clone_point(&self) -> Point {
        Point {
            x: self.x,
            y: self.y,
        }
    }

    /// 两点相加
    #[napi]
    pub fn add(&self, other: &Point) -> Point {
        self + other
    }

    /// 两点相减
    #[napi]
    pub fn sub(&self, other: &Point) -> Point {
        self - other
    }

    /// 计算两个点的点乘
    #[napi]
    pub fn dot_mul(&self, other: &Point) -> f64 {
        self.x * other.x + self.y * other.y
    }

    /// 判断两点是否在某精度范围内相等
    #[napi]
    pub fn nearly_eq(&self, other: &Point, eps: f64) -> bool {
        (self.x - other.x).abs() <= eps.abs() && (self.y - other.y).abs() <= eps.abs()
    }

    /// 转换为字符串
    #[napi]
    pub fn to_string(&self) -> String {
        format!("Point({}, {})", self.x, self.y)
    }

    /// 转换为 JSON 对象
    #[napi]
    pub fn serialize(&self) -> PointJSON {
        PointJSON {
            x: self.x,
            y: self.y,
        }
    }

    /// 序列化为数组 [x, y]
    #[napi]
    pub fn serialize_to_array(&self) -> Vec<f64> {
        vec![self.x, self.y]
    }

    /// 从 JSON 对象解析创建点
    #[napi(factory)]
    pub fn parse(json: PointJSON) -> Point {
        Point {
            x: json.x,
            y: json.y,
        }
    }

    /// 从数组解析创建点
    #[napi(factory)]
    pub fn parse_from_array(arr: Vec<f64>) -> Result<Point> {
        if arr.len() >= 2 {
            Ok(Point {
                x: arr[0],
                y: arr[1],
            })
        } else {
            Err(napi::Error::from_reason(
                "Array must have at least 2 elements",
            ))
        }
    }
}
