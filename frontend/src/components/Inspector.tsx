import { devices, labels, type Assumption } from '../data/building';
export default function Inspector({ selected, values, onSelect, onChange }: { selected: string | null; values: Record<string, Assumption>; onSelect: (id: string) => void; onChange: (id: string, value: Assumption) => void }) {
  const device = devices.find(d => d.id === selected);
  const value = device ? values[device.id] : null;
  return <aside className="inspector">
    <div className="eyebrow">SYSTEM INSPECTOR</div>
    <h2>{device ? labels[device.kind] : 'Explore your building'}</h2>
    <p className="muted">{device ? device.name : 'Click an object in the building or choose equipment below to inspect its assumptions.'}</p>
    <label className="field">Equipment<select value={selected ?? ''} onChange={e => onSelect(e.target.value)}><option value="" disabled>Select a component</option>{devices.map(d => <option key={d.id} value={d.id}>{d.floor === 3 ? 'Roof' : `F${d.floor + 1}`} · {d.name}</option>)}</select></label>
    {device && value && <>
      <div className="identity"><span>Component ID</span><code>{device.id}</code></div>
      {device.kind === 'toilet' ? <div className="notice">Selectable plumbing asset. Water consumption and hot-water demand are not modelled in this electrical-load prototype.</div> : <>
        <label className="field">Electrical input (W)<input type="number" min="0" max="100000" value={value.watts} onChange={e => onChange(device.id, { ...value, watts: Math.max(0, Math.min(100000, Number(e.target.value))) })}/></label>
        <label className="field">Operating hours / working day<input type="number" min="0" max="24" step="0.5" value={value.hours} onChange={e => onChange(device.id, { ...value, hours: Math.max(0, Math.min(24, Number(e.target.value))) })}/></label>
        <div className="device-total"><span>Illustrative annual electricity</span><strong>{Math.round(value.watts * value.hours * 250 / 1000).toLocaleString()} <small>kWh</small></strong></div>
        {device.kind === 'heatPump' && <div className="notice">Electrical input only. Heating demand, weather and COP are not yet simulated.</div>}
      </>}
    </>}
    <div className="inventory"><div className="eyebrow">BUILDING INVENTORY</div>{Object.entries(labels).map(([kind, label]) => <div key={kind}><span>{label}</span><strong>{devices.filter(d => d.kind === kind).length}</strong></div>)}</div>
    <div className="notice">Prototype assumptions: 250 operating days/year. No thermal simulation, tariffs, investment costs or ROI yet. Edits are kept in memory.</div>
  </aside>;
}
