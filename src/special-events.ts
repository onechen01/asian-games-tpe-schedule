export type CeremonyType = 'OPENING' | 'CLOSING';

export type SpecialEvent = {
  id:string;
  kind:'CEREMONY';
  ceremonyType:CeremonyType;
  titleZh:string;
  date:string;
  originalStartTime:string;
  startTimeTaipei:string;
  originalTimezone:'Asia/Tokyo';
  displayTimezone:'Asia/Taipei';
  source:{
    sourceKind:'OFFICIAL_CEREMONY_SCHEDULE';
    publisher:string;
    documentTitle:string;
    sourceUrl:string;
    fetchedAt:string|null;
    checkedAt:string;
    rawFile:string|null;
  };
};

const VALID_TYPES = new Set<CeremonyType>(['OPENING','CLOSING']);
const validIso = (value:unknown,offset:string)=>typeof value === 'string'
  && value.endsWith(offset) && Number.isFinite(Date.parse(value));

export function parseSpecialEvent(value:unknown):SpecialEvent {
  if (!value || typeof value !== 'object') throw new Error('Special event must be an object');
  const event=value as SpecialEvent;
  if (typeof event.id !== 'string' || !event.id
    || event.kind !== 'CEREMONY' || !VALID_TYPES.has(event.ceremonyType)
    || typeof event.titleZh !== 'string' || !event.titleZh
    || !/^2026-\d{2}-\d{2}$/.test(event.date)
    || !validIso(event.originalStartTime,'+09:00')
    || !validIso(event.startTimeTaipei,'+08:00')
    || event.originalStartTime.slice(0,10) !== event.date
    || event.startTimeTaipei.slice(0,10) !== event.date
    || event.originalTimezone !== 'Asia/Tokyo'
    || event.displayTimezone !== 'Asia/Taipei') {
    throw new Error(`Invalid special event ${event.id ?? '(unknown)'}`);
  }
  const source=event.source;
  if (!source || source.sourceKind !== 'OFFICIAL_CEREMONY_SCHEDULE'
    || typeof source.publisher !== 'string' || !source.publisher
    || typeof source.documentTitle !== 'string' || !source.documentTitle
    || typeof source.sourceUrl !== 'string' || !/^https:\/\//.test(source.sourceUrl)
    || typeof source.checkedAt !== 'string' || !Number.isFinite(Date.parse(source.checkedAt))
    || (source.fetchedAt !== null && !Number.isFinite(Date.parse(source.fetchedAt)))
    || (source.rawFile !== null && typeof source.rawFile !== 'string')) {
    throw new Error(`Invalid special-event provenance ${event.id}`);
  }
  return event;
}

export function parseSpecialEvents(value:unknown):SpecialEvent[] {
  if (!value || typeof value !== 'object') throw new Error('Special-events document must be an object');
  const doc=value as {schemaVersion?:unknown;events?:unknown};
  if (doc.schemaVersion !== 1 || !Array.isArray(doc.events)) {
    throw new Error('Special-events schema mismatch');
  }
  const events=doc.events.map(parseSpecialEvent);
  if (new Set(events.map(event=>event.id)).size !== events.length) {
    throw new Error('Duplicate special-event id');
  }
  return events;
}

export const specialEventsForDate = (events:SpecialEvent[],date:string)=>
  events.filter(event=>event.date === date).sort((a,b)=>a.startTimeTaipei.localeCompare(b.startTimeTaipei));
