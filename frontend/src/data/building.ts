export const FLOOR_HEIGHT = 3.6;
export const FLOOR_COUNT = 3;
export type DeviceKind = 'monitor' | 'computer' | 'light' | 'toilet' | 'heatPump';
export type Device = { id: string; name: string; kind: DeviceKind; floor: number; position: [number, number, number]; watts: number; hours: number };
export const labels: Record<DeviceKind, string> = { monitor: 'Monitor', computer: 'Computer', light: 'LED lighting', toilet: 'Toilet', heatPump: 'Heat pump' };
export const devices: Device[] = [];
for (let floor = 0; floor < FLOOR_COUNT; floor++) {
  const y = floor * FLOOR_HEIGHT;
  [-5.2, -1.8, 1.6].forEach((x, desk) => {
    [-2.3, 1.2].forEach((z, row) => {
      const key = `${floor}-${desk}-${row}`;
      devices.push({ id: `monitor-${key}`, name: `Desk ${desk * 2 + row + 1} · Monitor`, kind: 'monitor', floor, position: [x, y + 1.25, z], watts: 28, hours: 8 });
      devices.push({ id: `computer-${key}`, name: `Desk ${desk * 2 + row + 1} · Computer`, kind: 'computer', floor, position: [x + .85, y + .55, z], watts: 120, hours: 8 });
    });
  });
  [-4, 0, 4].forEach((x, i) => devices.push({ id: `light-${floor}-${i}`, name: `Ceiling light ${i + 1}`, kind: 'light', floor, position: [x, y + 3.05, 0], watts: 36, hours: 10 }));
  [-1.8, .2].forEach((z, i) => devices.push({ id: `toilet-${floor}-${i}`, name: `Restroom ${i + 1}`, kind: 'toilet', floor, position: [5.7, y + .15, z], watts: 0, hours: 0 }));
}
devices.push({ id: 'heat-pump-main', name: 'Central rooftop heat pump', kind: 'heatPump', floor: 3, position: [3, FLOOR_COUNT * FLOOR_HEIGHT + .3, 0], watts: 3500, hours: 6 });
export type Assumption = { watts: number; hours: number };
export const initialAssumptions: Record<string, Assumption> = Object.fromEntries(devices.map(d => [d.id, { watts: d.watts, hours: d.hours }]));
// Illustrative electrical load only: not a thermal, weather, or financial model.
export function annualKWh(values: Record<string, Assumption>) {
  return Object.values(values).reduce((sum, d) => sum + d.watts * d.hours * 250 / 1000, 0);
}
