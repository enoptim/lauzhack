export const FLOOR_HEIGHT = 3.6;
export const FLOOR_COUNT = 3;

export type Device = {
  id: string;
  kind: 'monitor' | 'computer' | 'light' | 'toilet' | 'heatPump';
  position: [number, number, number];
};

export const devices: Device[] = [];

for (let floor = 0; floor < FLOOR_COUNT; floor++) {
  const y = floor * FLOOR_HEIGHT;

  [-5.2, -1.8, 1.6].forEach((x, desk) => {
    [-2.3, 1.2].forEach((z, row) => {
      const key = `${floor}-${desk}-${row}`;
      devices.push({ id: `monitor-${key}`, kind: 'monitor', position: [x, y + 1.25, z] });
      devices.push({ id: `computer-${key}`, kind: 'computer', position: [x + .85, y + .55, z] });
    });
  });

  [-4, 0, 4].forEach((x, i) => {
    devices.push({ id: `light-${floor}-${i}`, kind: 'light', position: [x, y + 3.05, 0] });
  });

  [-1.8, .2].forEach((z, i) => {
    devices.push({ id: `toilet-${floor}-${i}`, kind: 'toilet', position: [5.7, y + .15, z] });
  });
}

devices.push({
  id: 'heat-pump-main',
  kind: 'heatPump',
  position: [3, FLOOR_COUNT * FLOOR_HEIGHT + .3, 0],
});
