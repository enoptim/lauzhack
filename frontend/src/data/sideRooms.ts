/// <reference types="vite/client" />
import geometry from '../../../data/geometry.json';
import roomCsv from '../../../data/rooms.csv?raw';

// Only the eight teaching rooms replace the old side-room banks. Keep the
// entrance and buffet ends reserved instead of importing a whole new floor.
const [header, ...rows] = roomCsv.trim().split(/\r?\n/).map(line => line.split(','));
const field = (row: string[], key: string) => row[header.indexOf(key)];
const outlines = new Map(geometry.rooms.filter(room => room.floor === 0).map(room => [room.room_id, room.polygons[0][0]]));
export const sideRooms = rows.filter(row => field(row,'floor') === '0' && ['seminar','computer_lab'].includes(field(row,'type'))).map(row => {
  const id = field(row,'room_id');
  // Fit dataset teaching wings into the existing side bays (local shell units).
  const ring = outlines.get(id)!.map(([east,north]) => [(east-20.2)*.97, 32-(north-11.9)*64/52.9]);
  return { id, ring, lab: field(row,'type') === 'computer_lab', seats: Number(field(row,'seats')) };
});
