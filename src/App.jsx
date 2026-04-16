import React, { useMemo, useRef, useState } from 'react'
import { Download, Upload, Sigma, LineChart as LineChartIcon, FileSpreadsheet, CheckCircle2, XCircle } from 'lucide-react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts'

const defaultParams = {
  L: 660e-9,
  Rc: 0.01,
  Co: 250e-6,
  RL: 1.0,
  Ton: 1.2377959e-6,
  Tsw: 2.47311868e-6,
  Vin: 12.0,
  Vout: 5.0551628,
}

function fmt(v, digits = 4) {
  if (!Number.isFinite(v)) return 'Infinity'
  const av = Math.abs(v)
  if (av >= 1e4 || (av > 0 && av < 1e-3)) return v.toExponential(3)
  return v.toFixed(digits)
}

function parseNumeric(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : NaN
}

function complex(re, im = 0) {
  return { re, im }
}

function cAdd(a, b) {
  return { re: a.re + b.re, im: a.im + b.im }
}

function cMul(a, b) {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  }
}

function cDiv(a, b) {
  const den = b.re * b.re + b.im * b.im
  return {
    re: (a.re * b.re + a.im * b.im) / den,
    im: (a.im * b.re - a.re * b.im) / den,
  }
}

function cAbs(a) {
  return Math.hypot(a.re, a.im)
}

function cPhaseDeg(a) {
  return (Math.atan2(a.im, a.re) * 180) / Math.PI
}

function unwrapPhaseDeg(phases) {
  if (!phases.length) return []
  const out = [phases[0]]
  for (let i = 1; i < phases.length; i += 1) {
    let value = phases[i]
    let delta = value - out[i - 1]
    while (delta > 180) {
      value -= 360
      delta = value - out[i - 1]
    }
    while (delta < -180) {
      value += 360
      delta = value - out[i - 1]
    }
    out.push(value)
  }
  return out
}

function polyEvalComplex(coeffs, s) {
  let result = complex(0, 0)
  for (const coeff of coeffs) {
    result = cAdd(cMul(result, s), complex(coeff, 0))
  }
  return result
}

function logspace(startExp, endExp, n) {
  const out = []
  if (n <= 1) return [10 ** startExp]
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1)
    out.push(10 ** (startExp + (endExp - startExp) * t))
  }
  return out
}

function lerp1d(xs, ys, x) {
  if (!xs.length || xs.length !== ys.length) return NaN
  if (x <= xs[0]) return ys[0]
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1]

  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }

  const t = (x - xs[lo]) / (xs[hi] - xs[lo])
  return ys[lo] * (1 - t) + ys[hi] * t
}

function findLastZeroCrossing(x, y, target = 0) {
  let crossing = NaN
  for (let i = 1; i < x.length; i += 1) {
    const y0 = y[i - 1] - target
    const y1 = y[i] - target
    if (y0 === 0) {
      crossing = x[i - 1]
    } else if (y0 * y1 <= 0) {
      const t = y0 / (y0 - y1)
      crossing = x[i - 1] + (x[i] - x[i - 1]) * t
    }
  }
  return crossing
}

function evaluateMetricsFromSweep(xs, mags, phasesWrapped) {
  const phasesUnwrapped = unwrapPhaseDeg(phasesWrapped)
  const ugb = findLastZeroCrossing(xs, mags, 0)
  const phaseAtUgbWrapped = Number.isFinite(ugb) ? lerp1d(xs, phasesWrapped, ugb) : NaN
  const phaseAtUgbUnwrapped = Number.isFinite(ugb) ? lerp1d(xs, phasesUnwrapped, ugb) : NaN
  const pm = Number.isFinite(phaseAtUgbUnwrapped) ? 180 + phaseAtUgbUnwrapped : NaN
  const gmFreq = findLastZeroCrossing(xs, phasesUnwrapped, -180)
  const magAtGm = Number.isFinite(gmFreq) ? lerp1d(xs, mags, gmFreq) : NaN
  const gm = Number.isFinite(magAtGm) ? -magAtGm : Infinity

  return {
    ugb,
    phaseAtUgbWrapped,
    phaseAtUgbUnwrapped,
    pm,
    gmFreq,
    magAtGm,
    gm,
  }
}

function multiplyPoly(a, b) {
  const result = Array(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      result[i + j] += a[i] * b[j]
    }
  }
  return result
}

function validateParams(params) {
  for (const [key, raw] of Object.entries(params)) {
    const v = Number(raw)
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(`参数 ${key} 必须是大于 0 的数值。`)
    }
  }
}

function evaluateLoopAtOmega(params, omega) {
  const { L, Rc, Co, RL, Ton, Tsw, Vin } = params
  const s = complex(0, omega)

  const w1 = Math.PI / Ton
  const Q1 = 2 / Math.PI
  const w2 = Math.PI / Tsw
  const q3Den = Math.PI * (Rc * Co - Ton / 2)
  if (q3Den <= 0) {
    throw new Error(`Rc*Co - Ton/2 = ${fmt(Rc * Co - Ton / 2, 6)} <= 0，参数不满足模型条件。`)
  }
  const Q3 = Tsw / q3Den

  const numGvd = [Vin * Rc * Co, Vin]
  const denGvd = [L * Co * (1 + Rc / RL), Rc * Co + L / RL, 1]
  const den1 = [1 / (w1 * w1), 1 / (Q1 * w1), 1]
  const den2 = [1 / (w2 * w2), 1 / (Q3 * w2), 1]
  const denProd = multiplyPoly(den1, den2)
  const denF = denProd.map((v) => v * Vin)

  const numFdx = [L * Co * (1 + Rc / RL), 0, 0]
  const numFox = [-L * Co * (1 + Rc / RL), -(Rc * Co + L / RL), -1]

  const Gvd = cDiv(polyEvalComplex(numGvd, s), polyEvalComplex(denGvd, s))
  const Fdx = cDiv(polyEvalComplex(numFdx, s), polyEvalComplex(denF, s))
  const Fox = cDiv(polyEvalComplex(numFox, s), polyEvalComplex(denF, s))

  const denom = cAdd(complex(1, 0), cMul(Fox, Gvd))
  const loop = cDiv(cMul(Fdx, Gvd), denom)

  return { loop, w1, Q1, w2, Q3 }
}

function computeAnalysis(params, simplis) {
  validateParams(params)

  const freqs = logspace(1, 7, 4000)
  const rows = []
  let meta = null

  for (const f of freqs) {
    const omega = 2 * Math.PI * f
    const response = evaluateLoopAtOmega(params, omega)
    meta = { w1: response.w1, Q1: response.Q1, w2: response.w2, Q3: response.Q3 }
    rows.push({
      freq: f,
      mag: 20 * Math.log10(cAbs(response.loop)),
      phase: cPhaseDeg(response.loop),
    })
  }

  const xs = rows.map((d) => d.freq)
  const mags = rows.map((d) => d.mag)
  const phasesWrapped = rows.map((d) => d.phase)
  const exact10 = evaluateLoopAtOmega(params, 2 * Math.PI * 10).loop
  const metricsFromSweep = evaluateMetricsFromSweep(xs, mags, phasesWrapped)

  let simplisMetrics = null
  let compareRows = []
  let errors = null

  if (simplis?.length) {
    const normalizedSimplis = simplis
      .filter((d) => Number.isFinite(d.freq) && Number.isFinite(d.mag) && Number.isFinite(d.phase))
      .sort((a, b) => a.freq - b.freq)

    const sFreq = normalizedSimplis.map((d) => d.freq)
    const sMag = normalizedSimplis.map((d) => d.mag)
    const sPhaseWrapped = normalizedSimplis.map((d) => d.phase)
    const sMetrics = evaluateMetricsFromSweep(sFreq, sMag, sPhaseWrapped)

    simplisMetrics = {
      gain10: lerp1d(sFreq, sMag, 10),
      phase10: lerp1d(sFreq, sPhaseWrapped, 10),
      ugb: sMetrics.ugb,
      pm: sMetrics.pm,
      gm: sMetrics.gm,
    }

    compareRows = normalizedSimplis.map((row) => {
      const pyMag = lerp1d(xs, mags, row.freq)
      const pyPhase = lerp1d(xs, phasesWrapped, row.freq)
      return {
        freq: row.freq,
        pythonMag: pyMag,
        pythonPhase: pyPhase,
        simplisMag: row.mag,
        simplisPhase: row.phase,
        magError: pyMag - row.mag,
        phaseError: pyPhase - row.phase,
      }
    })

    const magErrors = compareRows.map((d) => Math.abs(d.magError))
    const phaseErrors = compareRows.map((d) => Math.abs(d.phaseError))
    errors = {
      avgMagError: magErrors.reduce((a, b) => a + b, 0) / magErrors.length,
      maxMagError: Math.max(...magErrors),
      avgPhaseError: phaseErrors.reduce((a, b) => a + b, 0) / phaseErrors.length,
      maxPhaseError: Math.max(...phaseErrors),
    }
  }

  return {
    meta,
    rows,
    metrics: {
      gain10: 20 * Math.log10(cAbs(exact10)),
      phase10: cPhaseDeg(exact10),
      ugb: metricsFromSweep.ugb,
      pm: metricsFromSweep.pm,
      gm: metricsFromSweep.gm,
    },
    simplisMetrics,
    compareRows,
    errors,
  }
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return []

  const splitLine = (line) => line.split(/,|\t|;/).map((s) => s.trim())
  const header = splitLine(lines[0])
  const headerLower = header.map((h) => h.toLowerCase())

  let startIndex = 1
  let freqIdx = headerLower.findIndex((h) => /freq|frequency|hz/.test(h))
  let magIdx = headerLower.findIndex((h) => /gain|mag|magnitude|db/.test(h))
  let phaseIdx = headerLower.findIndex((h) => /phase|deg|角度/.test(h))

  if (header.every((h) => Number.isFinite(Number(h)))) {
    startIndex = 0
    freqIdx = 0
    magIdx = 1
    phaseIdx = 2
  }

  if (freqIdx < 0) freqIdx = 0
  if (magIdx < 0) magIdx = 1
  if (phaseIdx < 0) phaseIdx = 2

  const rows = []
  for (let i = startIndex; i < lines.length; i += 1) {
    const cols = splitLine(lines[i])
    if (cols.length < 3) continue
    const freq = Number(cols[freqIdx])
    const mag = Number(cols[magIdx])
    const phase = Number(cols[phaseIdx])
    if ([freq, mag, phase].every(Number.isFinite)) {
      rows.push({ freq, mag, phase: phase - 180 })
    }
  }
  return rows.sort((a, b) => a.freq - b.freq)
}

function exportCSV(filename, rows) {
  const csv = rows.map((row) => row.map((v) => String(v)).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function runSelfTests() {
  const tests = []
  const add = (name, passed, detail) => tests.push({ name, passed, detail })

  try {
    const out = unwrapPhaseDeg([170, -170, -175, 179])
    add('unwrapPhaseDeg works', out[1] === 190 && out[3] === 179, `out=${out.join('/')}`)
  } catch (error) {
    add('unwrapPhaseDeg works', false, String(error))
  }

  try {
    const result = computeAnalysis(defaultParams, [])
    add('computeAnalysis returns 4000 bode points', result.rows.length === 4000, `rows=${result.rows.length}`)
  } catch (error) {
    add('computeAnalysis returns 4000 bode points', false, String(error))
  }

  try {
    const parsed = parseCSV('Frequency,Gain,Phase\n10,20,90\n100,5,45')
    add('parseCSV reads header-based CSV', parsed.length === 2 && parsed[0].phase === -90, `rows=${parsed.length}`)
  } catch (error) {
    add('parseCSV reads header-based CSV', false, String(error))
  }

  try {
    const metrics = computeAnalysis(defaultParams, []).metrics
    add('UGB/PM/GM are finite or Infinity', Number.isFinite(metrics.ugb) && Number.isFinite(metrics.pm), `ugb=${metrics.ugb}, pm=${metrics.pm}, gm=${metrics.gm}`)
  } catch (error) {
    add('UGB/PM/GM are finite or Infinity', false, String(error))
  }

  return tests
}

function Card({ title, children, icon }) {
  return (
    <section className="card">
      <div className="card-header">
        <div className="title-row">{icon}{title}</div>
      </div>
      <div className="card-body">{children}</div>
    </section>
  )
}

function MetricCard({ title, value, unit }) {
  return (
    <div className="metric-card">
      <div className="metric-title">{title}</div>
      <div className="metric-value">{value}<span>{unit}</span></div>
    </div>
  )
}

export default function App() {
  const [params, setParams] = useState(Object.fromEntries(Object.entries(defaultParams).map(([k, v]) => [k, String(v)])))
  const [simplisRows, setSimplisRows] = useState([])
  const [simplisName, setSimplisName] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('等待分析')
  const [tab, setTab] = useState('mag')
  const fileRef = useRef(null)

  const numericParams = useMemo(() => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, parseNumeric(v)])), [params])
  const selfTests = useMemo(() => runSelfTests(), [])

  const chartData = useMemo(() => {
    if (!result) return []
    if (!simplisRows.length) {
      return result.rows.map((d) => ({ freq: d.freq, pythonMag: d.mag, pythonPhase: d.phase, simplisMag: null, simplisPhase: null }))
    }
    return result.compareRows.length
      ? result.compareRows.map((d) => ({ freq: d.freq, pythonMag: d.pythonMag, pythonPhase: d.pythonPhase, simplisMag: d.simplisMag, simplisPhase: d.simplisPhase }))
      : result.rows.map((d) => ({ freq: d.freq, pythonMag: d.mag, pythonPhase: d.phase, simplisMag: null, simplisPhase: null }))
  }, [result, simplisRows])

  const comparisonChart = useMemo(() => result?.compareRows?.map((d) => ({ freq: d.freq, magError: d.magError, phaseError: d.phaseError })) ?? [], [result])

  const runAnalysis = () => {
    try {
      const computed = computeAnalysis(numericParams, simplisRows)
      setResult(computed)
      setError('')
      setStatus(simplisRows.length ? '分析完成，已与 SIMPLIS 对比' : '分析完成，仅显示 Python 理论结果')
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : '分析失败')
      setStatus('分析失败')
    }
  }

  const resetAll = () => {
    setParams(Object.fromEntries(Object.entries(defaultParams).map(([k, v]) => [k, String(v)])))
    setSimplisRows([])
    setSimplisName('')
    setResult(null)
    setError('')
    setStatus('已重置')
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleUpload = async (ev) => {
    const file = ev.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const rows = parseCSV(text)
    setSimplisRows(rows)
    setSimplisName(file.name)
    setStatus(`已载入 ${file.name}，共 ${rows.length} 个数据点`)
  }

  const exportComparison = () => {
    if (!result) return
    if (result.compareRows?.length) {
      exportCSV('cot_buck_comparison.csv', [
        ['Frequency_Hz', 'Gain_dB_Python', 'Phase_deg_Python', 'Gain_dB_SIMPLIS', 'Phase_deg_SIMPLIS', 'Gain_Error_dB', 'Phase_Error_deg'],
        ...result.compareRows.map((r) => [r.freq, r.pythonMag, r.pythonPhase, r.simplisMag, r.simplisPhase, r.magError, r.phaseError]),
      ])
      return
    }
    exportCSV('cot_buck_python_bode.csv', [
      ['Frequency_Hz', 'Gain_dB_Python', 'Phase_deg_Python'],
      ...result.rows.map((r) => [r.freq, r.mag, r.phase]),
    ])
  }

  const exportSummary = () => {
    if (!result) return
    const rows = [
      ['Parameter', 'Value'],
      ...Object.entries(numericParams).map(([k, v]) => [k, v]),
      ['w1_rad_s', result.meta?.w1 ?? ''],
      ['Q1', result.meta?.Q1 ?? ''],
      ['w2_rad_s', result.meta?.w2 ?? ''],
      ['Q3', result.meta?.Q3 ?? ''],
      ['Python_10Hz_Gain_dB', result.metrics?.gain10 ?? ''],
      ['Python_10Hz_Phase_deg', result.metrics?.phase10 ?? ''],
      ['Python_UGB_Hz', result.metrics?.ugb ?? ''],
      ['Python_PM_deg', result.metrics?.pm ?? ''],
      ['Python_GM_dB', result.metrics?.gm ?? ''],
    ]
    if (result.simplisMetrics) {
      rows.push(
        ['SIMPLIS_10Hz_Gain_dB', result.simplisMetrics.gain10],
        ['SIMPLIS_10Hz_Phase_deg', result.simplisMetrics.phase10],
        ['SIMPLIS_UGB_Hz', result.simplisMetrics.ugb],
        ['SIMPLIS_PM_deg', result.simplisMetrics.pm],
        ['SIMPLIS_GM_dB', result.simplisMetrics.gm],
        ['Avg_Mag_Error_dB', result.errors?.avgMagError ?? ''],
        ['Max_Mag_Error_dB', result.errors?.maxMagError ?? ''],
        ['Avg_Phase_Error_deg', result.errors?.avgPhaseError ?? ''],
        ['Max_Phase_Error_deg', result.errors?.maxPhaseError ?? ''],
      )
    }
    exportCSV('cot_buck_summary.csv', rows)
  }

  return (
    <div className="app-shell">
      <div className="layout">
        <div className="left-column">
          <Card title="COT Buck ESR 补偿器网页分析工具" icon={<Sigma size={20} />}>
            <p className="muted">输入参数 → 推导开环频响 → 载入 SIMPLIS CSV → 对比波特图 → 导出结果</p>
            <div className="grid-two">
              {[
                ['L', '电感 H'], ['Rc', 'ESR Ω'], ['Co', '输出电容 F'], ['RL', '负载 Ω'],
                ['Ton', '导通时间 s'], ['Tsw', '开关周期 s'], ['Vin', '输入电压 V'], ['Vout', '输出电压 V'],
              ].map(([key, label]) => (
                <label key={key} className="field">
                  <span>{label}</span>
                  <input value={params[key]} onChange={(e) => setParams((p) => ({ ...p, [key]: e.target.value }))} />
                </label>
              ))}
            </div>
            <div className="divider" />
            <label className="field">
              <span>SIMPLIS 数据 CSV</span>
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleUpload} />
            </label>
            <p className="tiny">自动识别频率 / 幅值 / 相位列；相位按原 Python 逻辑执行 phase - 180 deg 处理。</p>
            {simplisName ? <div className="badge">已载入：{simplisName}</div> : null}
            <div className="button-grid">
              <button className="btn btn-primary" onClick={runAnalysis}>运行分析</button>
              <button className="btn" onClick={resetAll}>重置参数</button>
              <button className="btn" onClick={exportComparison}><Download size={16} />导出曲线</button>
              <button className="btn" onClick={exportSummary}><FileSpreadsheet size={16} />导出汇总</button>
            </div>
            <div className="alert">状态：{status}</div>
            {error ? <div className="alert alert-error">错误：{error}</div> : null}
          </Card>

          <Card title="模型与公式">
            <div className="formula"><strong>Gvd(s)</strong> = Vin * (1 + sRcCo) / [1 + s(RcCo + L/RL) + s^2 * LCo(1 + Rc/RL)]</div>
            <div className="formula"><strong>Fdx(s)</strong> = LCo(1 + Rc/RL) * s^2 / {'{'}Vin * [(1 + s/(Q1w1) + s^2/w1^2)(1 + s/(Q3w2) + s^2/w2^2)]{'}'}</div>
            <div className="formula"><strong>Fox(s)</strong> = -[LCo(1 + Rc/RL) * s^2 + (RcCo + L/RL)s + 1] / {'{'}Vin * [(1 + s/(Q1w1) + s^2/w1^2)(1 + s/(Q3w2) + s^2/w2^2)]{'}'}</div>
            <div className="formula"><strong>Floop(s)</strong> = Fdx(s) * Gvd(s) / [1 + Fox(s) * Gvd(s)]</div>
            <p className="muted">其中：w1 = pi / Ton，Q1 = 2 / pi，w2 = pi / Tsw，Q3 = Tsw / [pi(RcCo - Ton/2)]。</p>
          </Card>

          <Card title="内置自检">
            <div className="test-list">
              {selfTests.map((test) => (
                <div key={test.name} className="test-row">
                  <div>
                    <div className="test-name">{test.name}</div>
                    <div className="tiny">{test.detail}</div>
                  </div>
                  <div className={test.passed ? 'test-pass' : 'test-fail'}>
                    {test.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                    {test.passed ? 'PASS' : 'FAIL'}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="right-column">
          <div className="metrics-grid">
            <MetricCard title="Python 10Hz 增益" value={result ? fmt(result.metrics.gain10, 2) : '--'} unit="dB" />
            <MetricCard title="Python 10Hz 相位" value={result ? fmt(result.metrics.phase10, 2) : '--'} unit="deg" />
            <MetricCard title="Python UGB" value={result ? fmt((result.metrics.ugb || 0) / 1000, 2) : '--'} unit="kHz" />
            <MetricCard title="Python PM" value={result ? fmt(result.metrics.pm, 2) : '--'} unit="deg" />
            <MetricCard title="Python GM" value={result ? fmt(result.metrics.gm, 2) : '--'} unit="dB" />
            <MetricCard title="Q3" value={result ? fmt(result.meta?.Q3, 4) : '--'} unit="" />
          </div>

          {result?.simplisMetrics ? (
            <div className="metrics-grid small-grid">
              <MetricCard title="平均幅值误差" value={fmt(result.errors?.avgMagError, 2)} unit="dB" />
              <MetricCard title="最大幅值误差" value={fmt(result.errors?.maxMagError, 2)} unit="dB" />
              <MetricCard title="平均相位误差" value={fmt(result.errors?.avgPhaseError, 2)} unit="deg" />
              <MetricCard title="最大相位误差" value={fmt(result.errors?.maxPhaseError, 2)} unit="deg" />
            </div>
          ) : null}

          <Card title="波特图" icon={<LineChartIcon size={20} />}>
            <div className="tabs">
              <button className={tab === 'mag' ? 'tab active' : 'tab'} onClick={() => setTab('mag')}>幅频</button>
              <button className={tab === 'phase' ? 'tab active' : 'tab'} onClick={() => setTab('phase')}>相频</button>
              <button className={tab === 'error' ? 'tab active' : 'tab'} onClick={() => setTab('error')}>误差</button>
            </div>

            {tab === 'mag' && (
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="freq" scale="log" domain={[10, 1e7]} tickFormatter={(v) => `${v}`} />
                    <YAxis unit=" dB" />
                    <Tooltip formatter={(value, name) => [fmt(Number(value), 3), name]} labelFormatter={(v) => `频率: ${fmt(Number(v), 3)} Hz`} />
                    <Legend />
                    <ReferenceLine y={0} strokeDasharray="4 4" />
                    <ReferenceLine x={10} strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="pythonMag" name="Python" dot={false} strokeWidth={2} isAnimationActive={false} />
                    <Line type="monotone" dataKey="simplisMag" name="SIMPLIS" dot={false} strokeWidth={2} strokeDasharray="6 4" isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {tab === 'phase' && (
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="freq" scale="log" domain={[10, 1e7]} tickFormatter={(v) => `${v}`} />
                    <YAxis unit=" deg" />
                    <Tooltip formatter={(value, name) => [fmt(Number(value), 3), name]} labelFormatter={(v) => `频率: ${fmt(Number(v), 3)} Hz`} />
                    <Legend />
                    <ReferenceLine y={-180} strokeDasharray="4 4" />
                    <ReferenceLine x={10} strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="pythonPhase" name="Python" dot={false} strokeWidth={2} isAnimationActive={false} />
                    <Line type="monotone" dataKey="simplisPhase" name="SIMPLIS" dot={false} strokeWidth={2} strokeDasharray="6 4" isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {tab === 'error' && (
              comparisonChart.length ? (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={comparisonChart} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" dataKey="freq" scale="log" domain={['dataMin', 'dataMax']} tickFormatter={(v) => `${v}`} />
                      <YAxis />
                      <Tooltip formatter={(value, name) => [fmt(Number(value), 3), name]} labelFormatter={(v) => `频率: ${fmt(Number(v), 3)} Hz`} />
                      <Legend />
                      <ReferenceLine y={0} strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="magError" name="幅值误差 (dB)" dot={false} strokeWidth={2} isAnimationActive={false} />
                      <Line type="monotone" dataKey="phaseError" name="相位误差 (deg)" dot={false} strokeWidth={2} strokeDasharray="6 4" isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : <div className="empty-state">载入 SIMPLIS 数据后，这里会显示 Python 与 SIMPLIS 的误差曲线。</div>
            )}
          </Card>

          <Card title="结果摘要" icon={<Upload size={20} />}>
            <div className="summary-grid">
              <div className="summary-box">
                <div className="summary-title">中间参数</div>
                <div>w1 = {result ? fmt(result.meta?.w1, 4) : '--'} rad/s</div>
                <div>Q1 = {result ? fmt(result.meta?.Q1, 4) : '--'}</div>
                <div>w2 = {result ? fmt(result.meta?.w2, 4) : '--'} rad/s</div>
                <div>Q3 = {result ? fmt(result.meta?.Q3, 4) : '--'}</div>
              </div>
              <div className="summary-box">
                <div className="summary-title">Python 指标</div>
                <div>10Hz 增益 = {result ? fmt(result.metrics.gain10, 3) : '--'} dB</div>
                <div>10Hz 相位 = {result ? fmt(result.metrics.phase10, 3) : '--'} deg</div>
                <div>UGB = {result ? fmt(result.metrics.ugb, 3) : '--'} Hz</div>
                <div>PM = {result ? fmt(result.metrics.pm, 3) : '--'} deg</div>
                <div>GM = {result ? fmt(result.metrics.gm, 3) : '--'} dB</div>
              </div>
              <div className="summary-box">
                <div className="summary-title">SIMPLIS 指标</div>
                <div>10Hz 增益 = {result?.simplisMetrics ? fmt(result.simplisMetrics.gain10, 3) : '--'} dB</div>
                <div>10Hz 相位 = {result?.simplisMetrics ? fmt(result.simplisMetrics.phase10, 3) : '--'} deg</div>
                <div>UGB = {result?.simplisMetrics ? fmt(result.simplisMetrics.ugb, 3) : '--'} Hz</div>
                <div>PM = {result?.simplisMetrics ? fmt(result.simplisMetrics.pm, 3) : '--'} deg</div>
                <div>GM = {result?.simplisMetrics ? fmt(result.simplisMetrics.gm, 3) : '--'} dB</div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
