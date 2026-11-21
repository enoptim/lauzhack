import { useState } from 'react';
import BuildingScene from './components/BuildingScene';
import Inspector from './components/Inspector';
import { annualKWh, devices, initialAssumptions } from './data/building';
export default function App() {
  const [floor, setFloor] = useState(2);
  const [selected, setSelected] = useState<string | null>(null);
  const [values, setValues] = useState(initialAssumptions);
  const total = annualKWh(values);
  const baseline = annualKWh(initialAssumptions);
  function select(id: string) {
    setSelected(id);
    const device = devices.find(d => d.id === id);
    if (device) setFloor(device.floor);
  }
  return <div className="app">
    <header><div className="brand"><span className="brand-icon">▧</span><div>atelier<span className="brand-sub">BUILDING INTELLIGENCE</span></div></div><div className="header-meta"><span className="status-dot"/> Interactive prototype <span className="badge">OFFICE / 001</span></div></header>
    <main><section className="workspace"><div className="scene-heading"><div className="eyebrow">DIGITAL TWIN / PROCEDURAL MODEL</div><h1>A workspace.<br/><span>A world of possibilities.</span></h1><p>Three floors. One connected scenario.</p></div>
      <div className="viewer"><BuildingScene floor={floor} selected={selected} onSelect={select}/></div>
      <nav className="floor-controls" aria-label="Visible floors">{['Ground', 'Floor 2', 'Floor 3', 'Roof'].map((label, i) => <button key={label} className={floor === i ? 'active' : ''} aria-pressed={floor === i} onClick={() => { setFloor(i); setSelected(null); }}>{label}</button>)}</nav>
      <div className="camera-hint">Drag to orbit · Scroll to zoom · Right-drag to pan · Click equipment</div>
    </section><Inspector selected={selected} values={values} onSelect={select} onChange={(id, value) => setValues(prev => ({ ...prev, [id]: value }))}/></main>
    <footer><div><span className="eyebrow">ILLUSTRATIVE ELECTRICAL LOAD</span><strong>{Math.round(total).toLocaleString()} <small>kWh / year</small></strong></div><div><span className="eyebrow">CHANGE VS BASELINE</span><strong className={total <= baseline ? 'saving' : ''}>{total > baseline ? '+' : ''}{Math.round(total - baseline).toLocaleString()} <small>kWh / year</small></strong></div><p>Whole building · All floors included<br/>Not a validated energy simulation</p><button className="reset" onClick={() => setValues(initialAssumptions)}>Reset scenario ↺</button></footer>
  </div>;
}
