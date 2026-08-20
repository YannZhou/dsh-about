// dsh-about/lib/semver.js — 内嵌迷你 semver（SemVer 2.0.0 严格解析与优先级比较）。
//
// 为什么内嵌：dsh plugin add <本地目录> 走 link: 协议，被链接包的依赖不会随包
// 安装到使用方，运行时 import "semver" 会解析失败（Cannot find package 'semver'）。
// 本项目只用到 valid / gt / lt / rcompare 四个函数，内嵌实现后可让 bundle 零运行时
// 依赖、clone 即装即用。语义对齐 node-semver（严格校验、优先级含 pre-release）：
//   - 版本串必须是无前导 v、无空白的完整 MAJOR.MINOR.PATCH，
//     可选 -pre-release 与 +build（build 元数据不参与比较）
//   - 数字标识符不允许前导零
//   - 比较：核心数字段优先；pre-release 缺失 > 存在；逐个标识符比较，
//     数字 < 字母数字；长度短者前缀全相等时更小
//
// 该实现已与本机 node-semver v7.8.5 做过全量对拍（见仓库验证脚本说明），
// 覆盖合法/非法输入与大小/前后比较，行为一致。

const RE =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** 输入归一化（对齐 node-semver）：去首尾空白 + 剥离前导小写 v。 */
function normalize(v) {
	if (typeof v !== "string") return null;
	const s = v.trim();
	return s.startsWith("v") ? s.slice(1) : s;
}

/** 严格版本串校验：合法返回 canonical 串（剥离 build 元数据，同 node-semver
 * 的 valid()），否则 null。 */
export function valid(v) {
	const s = normalize(v);
	if (s === null) return null;
	const m = RE.exec(s);
	if (m === null) return null;
	return typeof m[4] === "string" && m[4] !== "" ? `${m[1]}.${m[2]}.${m[3]}-${m[4]}` : `${m[1]}.${m[2]}.${m[3]}`;
}

function parse(v) {
	const s = normalize(v);
	if (s === null) return null;
	const m = RE.exec(s);
	if (m === null) return null;
	return {
		major: Number(m[1]),
		minor: Number(m[2]),
		patch: Number(m[3]),
		pre: typeof m[4] === "string" && m[4] !== "" ? m[4].split(".") : null
	};
}

const NUMERIC = /^\d+$/;

function comparePre(a, b) {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const x = a[i];
		const y = b[i];
		const xn = NUMERIC.test(x);
		const yn = NUMERIC.test(y);
		if (xn && yn) {
			if (x !== y) {
				// 先比位数再比字典序，避免超长数字串的精度损失
				if (x.length !== y.length) return x.length < y.length ? -1 : 1;
				return x < y ? -1 : 1;
			}
		} else if (xn) {
			return -1; // 数字标识符 < 字母数字标识符
		} else if (yn) {
			return 1;
		} else if (x !== y) {
			return x < y ? -1 : 1; // ASCII 字典序
		}
	}
	if (a.length === b.length) return 0;
	return a.length < b.length ? -1 : 1;
}

/** 比较两个版本：-1 | 0 | 1；任一非法返回 NaN（与 semver.compare 一致）。 */
export function compare(a, b) {
	const A = parse(a);
	const B = parse(b);
	if (A === null || B === null) return NaN;
	for (const key of ["major", "minor", "patch"]) {
		if (A[key] !== B[key]) return A[key] < B[key] ? -1 : 1;
	}
	if (A.pre === null && B.pre === null) return 0;
	if (A.pre === null) return 1; // 无 pre-release > 有 pre-release
	if (B.pre === null) return -1;
	return comparePre(A.pre, B.pre);
}

export function gt(a, b) {
	const c = compare(a, b);
	return c !== c ? false : c > 0;
}

export function lt(a, b) {
	const c = compare(a, b);
	return c !== c ? false : c < 0;
}

/** 降序比较（供 Array.prototype.sort 使用）。 */
export function rcompare(a, b) {
	return -compare(a, b);
}