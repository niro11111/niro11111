// Input schemas for tools. Arguments are validated before a plan may execute.
const S = (o) => o;
const str = (required = false, extra = {}) => ({ type: 'string', required, ...extra });
export const TOOL_SCHEMAS = {
  'tasks.create': S({ title: str(true, { max: 300 }), priority: str(false, { enum: ['high', 'normal', 'low'] }), due: str() }),
  'tasks.complete': S({ id: str(true) }),
  'calendar.create': S({ title: str(true, { max: 300 }), start: str(true) }),
  'reminders.create': S({ text: str(true, { max: 500 }), at: str(true) }),
  'memory.remember': S({ content: str(true, { max: 4000 }), type: str() }),
  'memory.search': S({ query: str(true) }),
  'documents.search': S({ query: str(true) }),
  'home.control': S({ entityId: str(true), action: str(true, { enum: ['turn_on', 'turn_off', 'lock', 'unlock', 'set_temperature', 'toggle'] }) }),
  'home.scene': S({ sceneId: str(true) }),
  'research.fetch': S({ url: str(true) }),
  'research.web': S({ query: str(true, { max: 2000 }) }),
  'llm.answer': S({ prompt: str(true, { max: 20000 }) }),
  'wealth.transfer': S({ action: str(true) }),
  'shopping.add': S({ item: str(true, { max: 200 }) }),
  'computer.open_app': S({ name: str(true) }),
  'computer.open_url': S({ url: str(true) }),
  'computer.read_file': S({ path: str(true) }),
  'vision.describe': S({ image: str(true), mediaType: str(true) }),
  'voice.note': S({ text: str(true) }),
  'automation.run': S({ workflowId: str(true) }),
  'notify.send': S({ title: str(true) }),
};
