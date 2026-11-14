// dsh-about/lib/semver.js — 内嵌迷你 semver（SemVer 2.0.0 严格解析与优先级比较）。
//
// 为什么内嵌：dsh plugin add <本地目录> 走 link: 协议，被链接包的依赖不会随包
// 安装到使用方，运行时 import "semver" 会解析失败（Cannot find package 'semver'）。
// 提供版本校验、比较和 peer 范围匹配，内嵌实现后可让 bundle 零运行时
// 依赖、clone 即装即用。语义对齐 node-semver（严格校验、优先级含 pre-release）：
//   - 版本串归一化首尾空白与前导 v 后必须是完整 MAJOR.MINOR.PATCH，
//     可选 -pre-release 与 +build（build 元数据不参与比较）
//   - 数字标识符不允许前导零
//   - 比较：核心数字段优先；pre-release 缺失 > 存在；逐个标识符比较，
//     数字 < 字母数字；长度短者前缀全相等时更小
//
// 回归用例包含与 node-semver v7.8.5 对拍确认的版本及范围边界。

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
	if (s.length > 256 || m.slice(1, 4).some((part) => !Number.isSafeInteger(Number(part)))) return null;
	return typeof m[4] === "string" && m[4] !== "" ? `${m[1]}.${m[2]}.${m[3]}-${m[4]}` : `${m[1]}.${m[2]}.${m[3]}`;
}

function parse(v) {
	const s = normalize(v);
	if (s === null) return null;
	const m = RE.exec(s);
	if (m === null) return null;
	if (s.length > 256 || m.slice(1, 4).some((part) => !Number.isSafeInteger(Number(part)))) return null;
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

/** 比较两个版本：-1 | 0 | 1；任一非法返回 NaN。 */
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

// npm range grammar: comparator sets, ||, hyphens, x-ranges, tilde and caret.
// A prerelease only satisfies a set with an explicit prerelease comparator for
// the same major/minor/patch tuple. Invalid ranges return null for diagnostics.
function partialVersion(text, expandedRange = false) {
	// Caret/tilde/hyphen ranges normalize their own prefix and wildcard tails.
	// A plain comparator must not swallow a second '=' (e.g. '==1.2.3').
	if (expandedRange) text = text.replace(/^[v=]+/, "");
	const match = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(text);
	if (!match) return null;
	const values = match.slice(1, 4);
	if (values.some((part) => part !== undefined && !/^[xX*]$/.test(part) && (!/^(0|[1-9]\d*)$/.test(part) || !Number.isSafeInteger(Number(part))))) return null;
	let count = 0;
	for (const part of values) {
		if (part === undefined || /^[xX*]$/.test(part)) break;
		count++;
	}
	if (!expandedRange && values.slice(count).some((part) => part !== undefined && !/^[xX*]$/.test(part))) return null;
	const suffix = `${match[4] || ""}${match[5] || ""}`;
	if (suffix && (values[2] === undefined || !valid(`0.0.0${suffix}`))) return null;
	const nums = values.map((part, i) => i < count ? Number(part) : 0);
	const version = `${nums.join(".")}${count === 3 ? suffix : ""}`;
	if (!valid(version)) return null;
	return { nums, count, version: valid(version) };
}

function upperPartial(part) {
	const [major, minor] = part.nums;
	return part.count <= 1 ? `${major + 1}.0.0-0` : `${major}.${minor + 1}.0-0`;
}

function expandComparator(operator, text) {
	const part = partialVersion(text, operator === "^" || operator === "~" || operator === "~>");
	if (!part) return null;
	const { nums: [major, minor, patch], count, version } = part;
	if (count === 0) return operator === ">" || operator === "<" ? [["<", "0.0.0-0"]] : [];
	if (operator === "^" || operator === "~" || operator === "~>") {
		const upper = operator.startsWith("~")
			? count === 1 ? `${major + 1}.0.0-0` : `${major}.${minor + 1}.0-0`
			: major > 0 || count === 1 ? `${major + 1}.0.0-0`
				: minor > 0 || count === 2 ? `0.${minor + 1}.0-0` : `0.0.${patch + 1}-0`;
		return [[">=", version], ["<", upper]];
	}
	if (count === 3) return [[operator || "=", version]];
	if (operator === ">=") return [[">=", version]];
	if (operator === ">") return [[">=", upperPartial(part).replace(/-0$/, "")]];
	if (operator === "<=") return [["<", upperPartial(part)]];
	if (operator === "<") return [["<", `${major}.${minor}.${patch}-0`]];
	return [[">=", version], ["<", upperPartial(part)]];
}

export function satisfies(actual, range) {
	const parsed = parse(actual);
	if (!parsed || typeof range !== "string") return null;
	const sets = [];
	for (let clause of range.split("||")) {
		const comparators = [];
		let invalid = false;
		clause = clause.trim().replace(/(\S+)\s+-\s+(\S+)/g, (_, from, to) => {
			const low = partialVersion(from, true), high = partialVersion(to, true);
			if (!low || !high) { invalid = true; return ""; }
			const lower = low.count ? `>=${low.version}` : "";
			const upper = !high.count ? "" : high.count === 3 ? `<=${high.version}` : `<${upperPartial(high)}`;
			return `${lower} ${upper}`;
		}).replace(/(>=|<=|~>|[~^<>=])\s+/g, "$1");
		for (const token of clause.split(/\s+/).filter(Boolean)) {
			const match = /^(>=|<=|~>|[~^<>=])?(.*)$/.exec(token);
			const expanded = expandComparator(match[1] || "", match[2]);
			if (!expanded) { invalid = true; break; }
			comparators.push(...expanded);
		}
		if (invalid || comparators.some(([, base]) => !valid(base))) return null;
		sets.push(comparators);
	}
	return sets.some((set) => {
		if (!set.every(([op, base]) => {
			const cmp = compare(actual, base);
			return op === "=" ? cmp === 0 : op === ">=" ? cmp >= 0 : op === "<=" ? cmp <= 0 : op === ">" ? cmp > 0 : cmp < 0;
		})) return false;
		if (!parsed.pre) return true;
		return set.some(([, base]) => {
			const bound = parse(base);
			return bound.pre && bound.major === parsed.major && bound.minor === parsed.minor && bound.patch === parsed.patch;
		});
	});
}
