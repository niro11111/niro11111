// Server-side phrasing in Hebrew and English. JARVIS answers in the language the user spoke.
export const detectLang = (text = '') => (/[֐-׿]/.test(text) ? 'he' : 'en');

const D = {
  en: {
    briefing_title: 'Briefing for {day}', no_events: 'Schedule: no events today.', schedule: 'Schedule: {list}',
    top_tasks: 'Top tasks: {list}', no_tasks: 'No open tasks.', bills_soon: 'Bills soon: {list}', no_bills: 'No bills due in the next 14 days.',
    pending_approvals: 'Pending approvals: {n}', offline_devices: 'Offline devices: {list}', recommended: 'Recommended next: {list}',
    next_overdue_task: 'Close overdue task: {t}', next_pay_bills: 'Pay overdue bills', next_review_approvals: 'Review {n} pending approval(s)', next_start: 'Start with: {t}',
    task_added: 'Task added: {t}', task_done: 'Completed: {t}', reminder_set: 'Reminder set: "{t}" at {at}', event_added: 'Event "{t}" at {at}', event_conflict: ' - conflicts with {list}',
    remembered: 'Remembered ({p}): {c}', remembered_dup: 'I already know that: {c}', memory_none: 'Nothing relevant in memory.', memory_off: 'Memory is turned off in the Privacy Center.',
    spent_month: 'This month ({m}) you spent {e} (income {i}).', prev_month: 'Previous month: {p} - change {c}.', potential: 'Potential monthly saving found: {s}.', recs: 'Recommendations:',
    networth: 'Total assets {a}, liabilities {l}, net worth {n}.', bills_none: 'No bills due in the next 14 days.', overdue: ' (OVERDUE)', due: 'due',
    goal_line: '- {n}: {p}% ({s} of {t}){m}{b}', goal_months: ', ~{m} months to go', goal_behind: ' - behind schedule', goals_none: 'No savings goals defined.',
    sim: 'With these cuts you could save about {m} per month ({y} per year). This is a calculation, not a guarantee.',
    not_executed: 'Not executed. JARVIS does not execute financial transactions. Review the proposal and perform it with your bank or provider after your own confirmation.',
    device_state: '{n}: {s}', all_online: 'All devices are online.', no_devices: 'No devices.', offline: 'OFFLINE', scene_on: 'Scene {s} activated.',
    approval_needed: 'Approval needed before I {d}.', cancelled: 'Cancelled. I did not {d}.', failed: 'I could not complete this: {e}.', done_before: 'Completed before the failure:',
    advisory: 'Advisory mode is on, so I did not act. Here is what I would do:', denied: 'Not permitted: {list}',
    no_llm: 'this needs a language model, and none is configured (set ANTHROPIC_API_KEY). Built-in commands still work offline: briefing, tasks, reminders, finances, smart home, memory',
    health_off: 'Health data is off. Enable it in the Privacy Center first.', health_none: 'No health data has been synced yet.',
    health_summary: 'Last 7 days: {steps} steps/day on average ({ds} vs the week before), sleep {sleep} h/night, resting heart rate {hr} bpm.', health_note: 'This is a summary of your data, not medical advice.',
    shopping_added: 'Added to the shopping list: {t}', shopping_list: 'Shopping list: {list}', shopping_empty: 'The shopping list is empty.',
    weekly_title: 'Weekly report since {d}', weekly_done: 'Completed: {n}', weekly_open: 'Open: {n}', weekly_deadlines: 'Deadlines this week: {list}', none: 'none',
  },
  he: {
    briefing_title: 'תדריך ליום {day}', no_events: 'לו״ז: אין אירועים היום.', schedule: 'לו״ז: {list}',
    top_tasks: 'משימות מובילות: {list}', no_tasks: 'אין משימות פתוחות.', bills_soon: 'חשבונות קרובים: {list}', no_bills: 'אין חשבונות לתשלום ב-14 הימים הקרובים.',
    pending_approvals: 'אישורים ממתינים: {n}', offline_devices: 'מכשירים לא מחוברים: {list}', recommended: 'הצעד הבא המומלץ: {list}',
    next_overdue_task: 'לסגור משימה באיחור: {t}', next_pay_bills: 'לשלם חשבונות שעבר מועדם', next_review_approvals: 'לעבור על {n} אישורים ממתינים', next_start: 'להתחיל ב: {t}',
    task_added: 'נוספה משימה: {t}', task_done: 'הושלם: {t}', reminder_set: 'תזכורת נקבעה: "{t}" ב-{at}', event_added: 'האירוע "{t}" נקבע ל-{at}', event_conflict: ' - מתנגש עם {list}',
    remembered: 'שמרתי ({p}): {c}', remembered_dup: 'זה כבר שמור אצלי: {c}', memory_none: 'לא מצאתי בזיכרון משהו רלוונטי.', memory_off: 'הזיכרון כבוי במרכז הפרטיות.',
    spent_month: 'החודש ({m}) הוצאתם {e} (הכנסות {i}).', prev_month: 'בחודש הקודם: {p} - שינוי של {c}.', potential: 'פוטנציאל חיסכון חודשי שזוהה: {s}.', recs: 'המלצות:',
    networth: 'סך נכסים {a}, התחייבויות {l}, שווי נקי {n}.', bills_none: 'אין חשבונות לתשלום ב-14 הימים הקרובים.', overdue: ' (באיחור)', due: 'לתשלום עד',
    goal_line: '- {n}: {p}% ({s} מתוך {t}){m}{b}', goal_months: ', עוד כ-{m} חודשים', goal_behind: ' - בפיגור', goals_none: 'לא הוגדרו יעדי חיסכון.',
    sim: 'עם הקיצוצים האלה אפשר לחסוך כ-{m} בחודש ({y} בשנה). זה חישוב, לא הבטחה.',
    not_executed: 'לא בוצע. ג׳ארוויס לא מבצע פעולות כספיות. עברו על ההצעה ובצעו אותה בבנק או אצל הספק לאחר אישור שלכם.',
    device_state: '{n}: {s}', all_online: 'כל המכשירים מחוברים.', no_devices: 'אין מכשירים.', offline: 'לא מחובר', scene_on: 'מצב {s} הופעל.',
    approval_needed: 'צריך את אישורך לפני ש{d}.', cancelled: 'בוטל. לא ביצעתי: {d}.', failed: 'לא הצלחתי להשלים: {e}.', done_before: 'מה שכן הושלם לפני התקלה:',
    advisory: 'מצב ייעוץ פעיל, לכן לא ביצעתי דבר. זה מה שהייתי עושה:', denied: 'אין הרשאה: {list}',
    no_llm: 'זה דורש מודל שפה ואף אחד לא מוגדר (צריך ANTHROPIC_API_KEY). הפקודות המובנות עובדות גם בלי: תדריך, משימות, תזכורות, כספים, בית חכם, זיכרון',
    health_off: 'נתוני הבריאות כבויים. יש להפעיל אותם קודם במרכז הפרטיות.', health_none: 'עדיין לא סונכרנו נתוני בריאות.',
    health_summary: '7 הימים האחרונים: בממוצע {steps} צעדים ביום ({ds} לעומת השבוע שלפני), שינה {sleep} שעות בלילה, דופק במנוחה {hr}.', health_note: 'זה סיכום של הנתונים שלך, לא ייעוץ רפואי.',
    shopping_added: 'נוסף לרשימת הקניות: {t}', shopping_list: 'רשימת קניות: {list}', shopping_empty: 'רשימת הקניות ריקה.',
    weekly_title: 'דוח שבועי מאז {d}', weekly_done: 'הושלמו: {n}', weekly_open: 'פתוחות: {n}', weekly_deadlines: 'מועדים השבוע: {list}', none: 'אין',
  },
};

export function t(lang, key, vars = {}) {
  const s = D[lang]?.[key] ?? D.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
}
