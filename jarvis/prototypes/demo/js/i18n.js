// UI strings in Hebrew (default, RTL) and English (LTR).
const D = {
  he: {
    login_hint: 'הדביקו את טוקן הגישה שהודפס בקונסולת השרת.', token: 'טוקן גישה', connect: 'התחברות', demo_data: 'נתוני דמו', mic_on: 'מיקרופון פעיל',
    sec_core: 'ליבה', sec_life: 'חיים', sec_system: 'מערכת',
    command: 'מרכז פיקוד', conversation: 'שיחה', map: 'מפת המערכת', agents: 'סביבת סוכנים', automations: 'סטודיו אוטומציות', knowledge: 'מרכז ידע', planner: 'משימות ולו״ז',
    wealth: 'Family Wealth OS', home: 'בית חכם', devices: 'מרכז מכשירים', console: 'קונסולת מפתחים', privacy: 'מרכז פרטיות', preferences: 'הגדרות',
    sub_command: 'סקירה מלאה של המערכת', sub_conversation: 'שיחה קולית וטקסטואלית', sub_map: 'המוח המרכזי, המנועים והלקוחות', sub_agents: '18 סוכנים מומחים',
    sub_automations: 'טריגרים, תנאים, אישורים ושגיאות', sub_knowledge: 'זיכרון ומסמכים', sub_planner: 'משימות, אירועים, תזכורות וקניות', sub_wealth: 'ניהול פיננסי משפחתי',
    sub_home: 'שליטה וניטור', sub_devices: 'מכשירים מחוברים והרשאות', sub_console: 'מודלים, API, תקלות ואבטחה', sub_privacy: 'זיכרון, הרשאות, נתונים ואבטחה', sub_preferences: 'אישיות, קול ומיקום', demo_no_export: 'ייצוא קבצים לא זמין בגרסת ההדגמה',
    talk: 'דבר עם ג׳ארוויס', stop: 'עצור', send: 'שלח', ask_ph: 'שאלו את ג׳ארוויס… / Ask JARVIS…',
    st_idle: 'מוכן', st_listening: 'מקשיב', st_thinking: 'חושב', st_processing: 'מעבד', st_speaking: 'מדבר', st_executing: 'מבצע', st_approval: 'ממתין לאישור', st_error: 'שגיאה',
    system_status: 'מצב מערכת', engines: 'מנועים', active_agents: 'סוכנים פעילים', current_task: 'משימה נוכחית', no_task: 'אין משימה פעילה', notifications: 'התראות', no_notifications: 'אין התראות',
    calendar: 'לו״ז קרוב', no_events: 'אין אירועים קרובים', finance: 'פיננסים', smart_home: 'בית חכם', weather: 'מזג אוויר', weather_na: 'מזג האוויר לא זמין', recent: 'פעילות אחרונה', suggestions: 'צעדים מוצעים', approvals: 'אישורים ממתינים', none_waiting: 'אין אישורים ממתינים',
    cpu: 'מעבד', memory: 'זיכרון', latency: 'השהיית AI', success: 'הצלחת משימות', net_worth: 'שווי נקי', spent_month: 'הוצאות החודש', income: 'הכנסות', savings_potential: 'פוטנציאל חיסכון', bills_soon: 'חשבונות קרובים',
    approve: 'אשר', reject: 'דחה', confirm_approve: 'לאשר את הפעולה הרגישה הזו?', devices_on: 'מכשירים פועלים', offline: 'לא מחובר', online: 'מחובר',
    budgets: 'תקציבים', recommendations: 'המלצות', goals: 'יעדי חיסכון', cashflow: 'תזרים: הכנסות מול הוצאות', by_category: 'הוצאות לפי קטגוריה', forecast: 'תחזית', simulate: 'סימולציה', scenario: 'סימולטור תרחישים', accounts: 'חשבונות', data_sources: 'מקורות הנתונים', months_6: '6 חודשים אחרונים', vs_prev: 'לעומת חודש קודם', expenses: 'הוצאות', net: 'נטו', assets: 'נכסים', liabilities: 'התחייבויות',
    autonomy: 'רמת אוטונומיה', autonomy_1: 'ייעוץ בלבד', autonomy_2: 'בסיוע (מאשר הכל)', autonomy_3: 'אוטונומיה מבוקרת', autonomy_4: 'האצלה מתקדמת',
    scope: 'תחום', tools: 'כלים', data_domains: 'תחומי מידע', steps_limit: 'מגבלת צעדים', delegates_to: 'מאציל ל', runs: 'הרצות', last_run: 'הרצה אחרונה', activity: 'פעילות',
    nl_workflow: 'תארו אוטומציה במילים', preview: 'תצוגה מקדימה', create: 'צור', workflows: 'תהליכים', run: 'הרץ', enable: 'הפעל', disable: 'השבת', delete: 'מחק', history: 'היסטוריית הרצות', guardrails: 'מגבלות בטיחות',
    memories: 'זיכרונות', search: 'חיפוש', add: 'הוסף', export: 'ייצוא', documents: 'מסמכים', save: 'שמור', edit: 'ערוך',
    register_device: 'רישום מכשיר', name: 'שם', kind: 'סוג', capabilities: 'יכולות', revoke: 'בטל גישה', token_once: 'הטוקן מוצג פעם אחת בלבד:', status_built: 'בנוי ונבדק', status_source: 'קוד מקור (לא נבנה כאן)', status_planned: 'מתוכנן',
    tasks: 'משימות', events: 'אירועים', shopping: 'רשימת קניות', reminders: 'תזכורות', new_task: 'משימה חדשה', new_event: 'אירוע חדש',
    models: 'מודלים', api_usage: 'שימוש ב-API', failed_tasks: 'משימות שנכשלו', security_events: 'אירועי אבטחה', cost: 'עלות משוערת',
    privacy_settings: 'הגדרות פרטיות', memory_enabled: 'זיכרון ארוך טווח', health_enabled: 'נתוני בריאות (אופציונלי)', store_transcripts: 'שמירת תמלולי קול', retention: 'שמירת קול (ימים)', proactive_enabled: 'תובנות יזומות', watch_fin: 'התראות כספיות בשעון',
    inventory: 'מה שמור', delete_voice: 'מחק את כל הקלטות הקול', export_all: 'ייצא את כל הנתונים', permissions: 'מדיניות הרשאות', audit: 'יומן ביקורת', agent_access: 'גישת סוכנים למידע', delete_domain: 'מחק תחום',
    personality: 'אישיות', style: 'סגנון', verbosity: 'אורך תשובות', humor: 'הומור', address_as: 'פנייה אליי', language: 'שפה', voice: 'קול', voice_rate: 'מהירות דיבור', barge: 'אפשר לקטוע את ג׳ארוויס', location: 'מיקום למזג אוויר', logout: 'התנתק', clear_chat: 'נקה שיחה',
    saved: 'נשמר', updated: 'עודכן', created: 'נוצר', no_stt: 'הדפדפן לא תומך בזיהוי דיבור. השתמשו ב-Chrome או Edge, או הקלידו.',
    try_hint: 'נסו: "תארגן לי את היום", "כמה הוצאנו החודש?", "כבה את האורות למטה", "תזכיר לי לשלם חשמל מחר ב-9".',
    clients: 'לקוחות', per_month_calc: 'לחודש · מחושב', core_desc: 'המוח המרכזי, התכנון, הזיכרון ותזמור הסוכנים',
  },
  en: {
    login_hint: 'Paste the access token printed in the server console.', token: 'Access token', connect: 'Connect', demo_data: 'demo data', mic_on: 'MIC ON',
    sec_core: 'Core', sec_life: 'Life', sec_system: 'System',
    command: 'Command Center', conversation: 'Conversation', map: 'System Map', agents: 'Agent Workspace', automations: 'Automation Studio', knowledge: 'Knowledge Center', planner: 'Tasks & Calendar',
    wealth: 'Family Wealth OS', home: 'Smart Home', devices: 'Device Center', console: 'Developer Console', privacy: 'Privacy Center', preferences: 'Settings',
    sub_command: 'Full system overview', sub_conversation: 'Voice and text conversation', sub_map: 'Core, engines and clients', sub_agents: '18 specialist agents',
    sub_automations: 'Triggers, conditions, approvals and error branches', sub_knowledge: 'Memory and documents', sub_planner: 'Tasks, events, reminders, shopping', sub_wealth: 'Family financial management',
    sub_home: 'Control and monitor', sub_devices: 'Connected devices and permissions', sub_console: 'Models, API, failures, security', sub_privacy: 'Memory, permissions, data and security', sub_preferences: 'Personality, voice, location', demo_no_export: 'File export is not available in the demo',
    talk: 'Talk to JARVIS', stop: 'Stop', send: 'Send', ask_ph: 'Ask JARVIS… / שאלו את ג׳ארוויס…',
    st_idle: 'Online', st_listening: 'Listening', st_thinking: 'Thinking', st_processing: 'Processing', st_speaking: 'Speaking', st_executing: 'Executing', st_approval: 'Awaiting approval', st_error: 'Error',
    system_status: 'System status', engines: 'Engines', active_agents: 'Active agents', current_task: 'Current task', no_task: 'No active task', notifications: 'Notifications', no_notifications: 'No notifications',
    calendar: 'Upcoming', no_events: 'No upcoming events', finance: 'Finance', smart_home: 'Smart home', weather: 'Weather', weather_na: 'Weather unavailable', recent: 'Recent activity', suggestions: 'Suggested next actions', approvals: 'Pending approvals', none_waiting: 'Nothing waiting',
    cpu: 'CPU', memory: 'Memory', latency: 'AI latency', success: 'Task success', net_worth: 'Net worth', spent_month: 'Spent this month', income: 'Income', savings_potential: 'Savings potential', bills_soon: 'Bills soon',
    approve: 'Approve', reject: 'Reject', confirm_approve: 'Approve this sensitive action?', devices_on: 'Devices on', offline: 'offline', online: 'online',
    budgets: 'Budgets', recommendations: 'Recommendations', goals: 'Savings goals', cashflow: 'Cash flow: income vs expenses', by_category: 'Spending by category', forecast: 'Forecast', simulate: 'Simulate', scenario: 'Scenario simulator', accounts: 'Accounts', data_sources: 'Data sources', months_6: 'Last 6 months', vs_prev: 'vs previous month', expenses: 'Expenses', net: 'Net', assets: 'Assets', liabilities: 'Liabilities',
    autonomy: 'Autonomy level', autonomy_1: 'Advisory only', autonomy_2: 'Assisted (asks for everything)', autonomy_3: 'Controlled autonomy', autonomy_4: 'Advanced delegation',
    scope: 'Scope', tools: 'Tools', data_domains: 'Data domains', steps_limit: 'Step limit', delegates_to: 'Delegates to', runs: 'Runs', last_run: 'Last run', activity: 'Activity',
    nl_workflow: 'Describe an automation in words', preview: 'Preview', create: 'Create', workflows: 'Workflows', run: 'Run', enable: 'Enable', disable: 'Disable', delete: 'Delete', history: 'Run history', guardrails: 'Guardrails',
    memories: 'Memories', search: 'Search', add: 'Add', export: 'Export', documents: 'Documents', save: 'Save', edit: 'Edit',
    register_device: 'Register a device', name: 'Name', kind: 'Kind', capabilities: 'Capabilities', revoke: 'Revoke', token_once: 'This token is shown only once:', status_built: 'built & tested', status_source: 'source (not built here)', status_planned: 'planned',
    tasks: 'Tasks', events: 'Events', shopping: 'Shopping list', reminders: 'Reminders', new_task: 'New task', new_event: 'New event',
    models: 'Models', api_usage: 'API usage', failed_tasks: 'Failed tasks', security_events: 'Security events', cost: 'Est. cost',
    privacy_settings: 'Privacy settings', memory_enabled: 'Long-term memory', health_enabled: 'Health data (optional)', store_transcripts: 'Store voice transcripts', retention: 'Voice retention (days)', proactive_enabled: 'Proactive insights', watch_fin: 'Financial alerts on watch',
    inventory: 'What is stored', delete_voice: 'Delete all voice data', export_all: 'Export all data', permissions: 'Permission policy', audit: 'Audit log', agent_access: 'Agent data access', delete_domain: 'Delete domain',
    personality: 'Personality', style: 'Style', verbosity: 'Answer length', humor: 'Humor', address_as: 'Address me as', language: 'Language', voice: 'Voice', voice_rate: 'Speaking speed', barge: 'Let me interrupt JARVIS', location: 'Weather location', logout: 'Sign out', clear_chat: 'Clear conversation',
    saved: 'Saved', updated: 'Updated', created: 'Created', no_stt: 'This browser has no speech recognition. Use Chrome or Edge, or type.',
    try_hint: 'Try: "organize my day", "how much did we spend this month?", "turn off the lights downstairs", "remind me to pay the electricity bill tomorrow at 9".',
    clients: 'Clients', per_month_calc: 'per month · calculated', core_desc: 'Reasoning, planning, memory and agent orchestration',
  },
};

let lang = 'he';
try { lang = localStorage.getItem('jarvis.lang') ?? 'he'; } catch { /* storage unavailable */ }

export const getLang = () => lang;
export const t = (k) => D[lang][k] ?? D.en[k] ?? k;
export function setLang(l) {
  lang = l;
  try { localStorage.setItem('jarvis.lang', l); } catch { /* ignore */ }
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'he' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
}
