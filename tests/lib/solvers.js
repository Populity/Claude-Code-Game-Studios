/** Puzzle solvers shared by unit tests and the browser smoke (no engine deps). */
/** Pipes: number of extra clicks per cell to reach the generator's target masks (onPath cells only). */
function pipesClicks(st) {
  const rot = (m, r) => { for (let i = 0; i < r; i++) m = ((m << 1) | (m >> 3)) & 15; return m; };
  return st.cells.map((c) => {
    if (!c.onPath) return 0;
    for (let k = 0; k < 4; k++) if (rot(c.base, (c.rot + k) % 4) === c.target) return k;
    return -1; // unreachable target
  });
}
/** Lights-out (cross toggle) over GF(2): returns array of cell indices to press, or null. */
function lightsSolve(on, n) {
  const N = n * n, A = [];
  for (let i = 0; i < N; i++) {
    const row = new Array(N + 1).fill(0);
    const x = i % n, y = Math.floor(i / n);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue; row[ny * n + nx] = 1;
    }
    row[N] = on[i] ? 0 : 1; A.push(row); // need cell i toggled iff off
  }
  let r = 0; const piv = [];
  for (let c = 0; c < N && r < N; c++) {
    let p = r; while (p < N && !A[p][c]) p++;
    if (p === N) continue;
    [A[r], A[p]] = [A[p], A[r]];
    for (let i = 0; i < N; i++) if (i !== r && A[i][c]) for (let k = c; k <= N; k++) A[i][k] ^= A[r][k];
    piv.push(c); r++;
  }
  for (let i = r; i < N; i++) if (A[i][N]) return null;
  const x = new Array(N).fill(0); piv.forEach((c, i) => { x[c] = A[i][N]; });
  return x.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
}
/** Logic: brute force all assignments; returns first env satisfying every fn. */
function logicSolve(inputs, fns) {
  for (let m = 0; m < 1 << inputs.length; m++) {
    const env = {}; inputs.forEach((k, j) => { env[k] = !!(m & (1 << j)); });
    if (fns.every((f) => f(env))) return env;
  }
  return null;
}
module.exports = { pipesClicks, lightsSolve, logicSolve };
