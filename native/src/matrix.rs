use std::vec;

use crate::Point;
use napi::Result;
use napi_derive::napi;

#[napi(object)]
pub struct MatrixJSON {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
}

#[napi]
pub struct Matrix {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
}

impl std::ops::Add for Matrix {
    type Output = Matrix;

    fn add(self, other: Matrix) -> Matrix {
        Matrix {
            a: self.a + other.a,
            b: self.b + other.b,
            c: self.c + other.c,
            d: self.d + other.d,
        }
    }
}

impl std::ops::Add for &Matrix {
    type Output = Matrix;

    fn add(self, other: &Matrix) -> Matrix {
        Matrix {
            a: self.a + other.a,
            b: self.b + other.b,
            c: self.c + other.c,
            d: self.d + other.d,
        }
    }
}

impl std::ops::Sub for Matrix {
    type Output = Matrix;

    fn sub(self, other: Matrix) -> Matrix {
        Matrix {
            a: self.a - other.a,
            b: self.b - other.b,
            c: self.c - other.c,
            d: self.d - other.d,
        }
    }
}

impl std::ops::Sub for &Matrix {
    type Output = Matrix;

    fn sub(self, other: &Matrix) -> Matrix {
        Matrix {
            a: self.a - other.a,
            b: self.b - other.b,
            c: self.c - other.c,
            d: self.d - other.d,
        }
    }
}

impl std::ops::Mul for &Matrix {
    type Output = Matrix;

    fn mul(self, rhs: &Matrix) -> Matrix {
        Matrix {
            a: self.a * rhs.a + self.c * rhs.b,
            b: self.b * rhs.a + self.d * rhs.b,
            c: self.a * rhs.c + self.c * rhs.d,
            d: self.b * rhs.c + self.d * rhs.d,
        }
    }
}

impl std::ops::Mul<&Point> for &Matrix {
    type Output = Point;

    fn mul(self, rhs: &Point) -> Point {
        Point {
            x: self.a * rhs.x + self.c * rhs.y,
            y: self.b * rhs.x + self.d * rhs.y,
        }
    }
}

impl std::ops::Mul<f64> for &Matrix {
    type Output = Matrix;

    fn mul(self, rhs: f64) -> Matrix {
        Matrix {
            a: self.a * rhs,
            b: self.b * rhs,
            c: self.c * rhs,
            d: self.d * rhs,
        }
    }
}

impl PartialEq for &Matrix {
    fn eq(&self, other: &Self) -> bool {
        self.a == other.a && self.b == other.b && self.c == other.c && self.d == other.d
    }
}

#[napi]
impl Matrix {
    /// 创建新矩阵
    #[napi(constructor)]
    pub fn new(a: f64, b: f64, c: f64, d: f64) -> Self {
        Matrix { a, b, c, d }
    }

    /// 获取 a
    #[napi(getter)]
    pub fn get_a(&self) -> f64 {
        self.a
    }

    /// 设置 a
    #[napi(setter)]
    pub fn set_a(&mut self, a: f64) {
        self.a = a
    }

    /// 获取 b
    #[napi(getter)]
    pub fn get_b(&self) -> f64 {
        self.b
    }

    /// 设置 b
    #[napi(setter)]
    pub fn set_b(&mut self, b: f64) {
        self.b = b
    }

    /// 获取 c
    #[napi(getter)]
    pub fn get_c(&self) -> f64 {
        self.c
    }

    /// 设置 c
    #[napi(setter)]
    pub fn set_c(&mut self, c: f64) {
        self.c = c
    }

    /// 获取 d
    #[napi(getter)]
    pub fn get_d(&self) -> f64 {
        self.d
    }

    /// 设置 d
    #[napi(setter)]
    pub fn set_d(&mut self, d: f64) {
        self.d = d
    }

    /// 克隆矩阵
    #[napi]
    pub fn clone_matrix(&self) -> Matrix {
        Matrix {
            a: self.a,
            b: self.b,
            c: self.c,
            d: self.d,
        }
    }

    /// 计算矩阵的行列式
    #[napi]
    pub fn det(&self) -> f64 {
        self.a * self.d - self.b * self.c
    }

    /// 矩阵相加
    #[napi]
    pub fn add(&self, other: &Matrix) -> Matrix {
        self + other
    }

    /// 矩阵相减
    #[napi]
    pub fn sub(&self, other: &Matrix) -> Matrix {
        self - other
    }

    /// 矩阵相乘
    #[napi]
    pub fn mul(&self, other: &Matrix) -> Matrix {
        self * other
    }

    /// 矩阵与实数相乘
    #[napi]
    pub fn scale(&self, scale: f64) -> Matrix {
        self * scale
    }

    /// 矩阵旋转
    #[napi]
    pub fn rotate(&self, radian: f64) -> Matrix {
        let m: Matrix = Matrix {
            a: radian.cos(),
            b: radian.sin(),
            c: -radian.sin(),
            d: radian.cos(),
        };
        self * &m
    }

    /// 判断两矩阵是否在某精度范围内相等
    #[napi]
    pub fn nearly_eq(&self, other: &Matrix, eps: f64) -> bool {
        (self.a - other.a).abs() <= eps.abs()
            && (self.b - other.b).abs() <= eps.abs()
            && (self.c - other.c).abs() <= eps.abs()
            && (self.d - other.d).abs() <= eps.abs()
    }

    /// 将矩阵应用到点上（矩阵乘以点）
    #[napi]
    pub fn apply_to_point(&self, point: &Point) -> Point {
        self * point
    }

    /// 获取矩阵中的元素
    #[napi]
    pub fn get(&self, x: i32, y: i32) -> Result<f64> {
        match x {
            0 => match y {
                0 => Ok(self.a),
                1 => Ok(self.c),
                _ => Err(napi::Error::from_reason("x must be 0 or 1")),
            },
            1 => match y {
                0 => Ok(self.b),
                1 => Ok(self.d),
                _ => Err(napi::Error::from_reason("x must be 0 or 1")),
            },
            _ => Err(napi::Error::from_reason("y must be 0 or 1")),
        }
    }

    /// 获取矩阵中的元素
    /// @param {number[]} arr - 长度为 2 的数组
    #[napi]
    pub fn get_from_arr(&self, arr: Vec<i32>) -> Result<f64> {
        if arr.len() >= 2 {
            self.get(arr[0], arr[1])
        } else {
            Err(napi::Error::from_reason(
                "Array must have at least 2 elements",
            ))
        }
    }

    /// 转换为字符串
    #[napi]
    pub fn to_string(&self) -> String {
        format!("Matrix[[{}, {}], [{}, {}]]", self.a, self.c, self.b, self.d)
    }

    /// 构建单位矩阵
    #[napi(factory)]
    pub fn identity() -> Matrix {
        Matrix {
            a: 1f64,
            b: 0f64,
            c: 0f64,
            d: 1f64,
        }
    }

    /// 转换为 JSON 对象
    #[napi]
    pub fn serialize(&self) -> MatrixJSON {
        MatrixJSON {
            a: self.a,
            b: self.b,
            c: self.c,
            d: self.d,
        }
    }

    /// 转换为二维数组
    #[napi]
    pub fn serialize_to_array(&self) -> Vec<Vec<f64>> {
        vec![vec![self.a, self.c], vec![self.b, self.d]]
    }

    /// 从 JSON 对象解析创建矩阵
    /// # JSDoc
    /// @param {{a: number, b: number, c: number, d: number}} json - 包含矩阵 a, b, c, d 的对象
    /// @returns {Matrix} 矩阵实例
    #[napi(factory)]
    pub fn parse(json: MatrixJSON) -> Matrix {
        Matrix {
            a: json.a,
            b: json.b,
            c: json.c,
            d: json.d,
        }
    }

    /// 从数组解析创建矩阵
    /// # JSDoc
    /// @param {number[number[]]} arr - 2x2 数组
    /// @returns {Matrix} 矩阵实例
    #[napi(factory)]
    pub fn parse_from_array(arr: Vec<Vec<f64>>) -> Result<Matrix> {
        if arr.len() >= 2 {
            if arr[0].len() < 2 || arr[1].len() < 2 {
                Err(napi::Error::from_reason(
                    "Element array must have at least 2 elements",
                ))
            } else {
                Ok(Matrix {
                    a: arr[0][0],
                    b: arr[1][0],
                    c: arr[0][1],
                    d: arr[1][1],
                })
            }
        } else {
            Err(napi::Error::from_reason(
                "Array must have at least 2 elements",
            ))
        }
    }
}

#[napi]
impl Point {
    #[napi]
    pub fn apply_transform(&mut self, matrix: &Matrix) -> &Self {
        let x = self.x;
        let y = self.y;
        self.x = x * matrix.a + y * matrix.c;
        self.y = x * matrix.b + y * matrix.d;
        self
    }

    #[napi]
    pub fn mul_matrix(matrix: &Matrix, point: &Point) -> Point {
        Point {
            x: point.x * matrix.a + point.y * matrix.c,
            y: point.x * matrix.b + point.y * matrix.d,
        }
    }
}
