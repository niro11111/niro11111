// JARVIS mobile (iOS + Android, Expo). Talks to the JARVIS server with a per-device token,
// keeps an offline queue through the shared SDK, receives push notifications, and shows
// approvals so a sensitive action started on the desktop can be approved from the phone.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, I18nManager, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
// @ts-ignore - plain JS SDK shared with web and tests
import { JarvisClient } from '../../sdk/jarvis-client.js';

const C = { bg: '#02040a', panel: 'rgba(10,22,44,0.85)', line: 'rgba(80,200,255,0.22)', cyan: '#2ee6ff', ice: '#9fe8ff', text: '#e6f6ff', muted: '#7f9bb8', green: '#22e08a', amber: '#ffbf3c', red: '#ff5d6c' };
type Msg = { role: 'user' | 'jarvis'; text: string; meta?: string };
type Tab = 'home' | 'chat' | 'approvals' | 'actions';

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }) });

export default function App() {
  const [cfg, setCfg] = useState<{ url: string; token: string } | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  useEffect(() => { (async () => { const url = await SecureStore.getItemAsync('url'); const token = await SecureStore.getItemAsync('token'); if (url && token) setCfg({ url, token }); })(); }, []);
  const client = useMemo(() => (cfg ? new JarvisClient({ baseUrl: cfg.url, token: cfg.token, storage: AsyncStorage }) : null), [cfg]);

  useEffect(() => {
    if (!client) return;
    registerPush(client).catch(() => {});
    const h = setInterval(() => client.sync().catch(() => {}), 20000);
    client.sync().catch(() => {});
    return () => clearInterval(h);
  }, [client]);

  if (!cfg || !client) return <Setup onDone={setCfg} />;
  return (
    <SafeAreaView style={s.root}>
      <Text style={s.brand}>J.A.R.V.I.S</Text>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <Home client={client} />}
        {tab === 'chat' && <Chat client={client} />}
        {tab === 'approvals' && <Approvals client={client} />}
        {tab === 'actions' && <Actions client={client} />}
      </View>
      <View style={s.tabs}>
        {(['home', 'chat', 'approvals', 'actions'] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabOn]} accessibilityRole="tab">
            <Text style={[s.tabText, tab === t && { color: C.cyan }]}>{{ home: 'ראשי', chat: 'שיחה', approvals: 'אישורים', actions: 'פעולות' }[t]}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

async function registerPush(client: any) {
  if (!Device.isDevice) return;
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  const { data } = await Notifications.getExpoPushTokenAsync();
  await client.request('/api/devices/push-token', { method: 'POST', body: { pushToken: data } });
}

function Setup({ onDone }: { onDone: (c: { url: string; token: string }) => void }) {
  const [url, setUrl] = useState('http://192.168.1.10:7777');
  const [token, setToken] = useState('');
  const save = async () => {
    try {
      const c = new JarvisClient({ baseUrl: url, token });
      await c.glance();
      await SecureStore.setItemAsync('url', url); await SecureStore.setItemAsync('token', token);
      onDone({ url, token });
    } catch (e: any) { Alert.alert('JARVIS', `החיבור נכשל: ${e.message}`); }
  };
  return (
    <SafeAreaView style={[s.root, { justifyContent: 'center', padding: 24 }]}>
      <Text style={[s.brand, { fontSize: 28 }]}>J.A.R.V.I.S</Text>
      <Text style={s.muted}>במחשב: מרכז מכשירים ← רישום מכשיר (ios/android), ואז הדביקו כאן את הטוקן.</Text>
      <TextInput style={s.input} value={url} onChangeText={setUrl} autoCapitalize="none" placeholder="Server URL" placeholderTextColor={C.muted} />
      <TextInput style={s.input} value={token} onChangeText={setToken} autoCapitalize="none" secureTextEntry placeholder="jd_…" placeholderTextColor={C.muted} />
      <Pressable style={s.primary} onPress={save}><Text style={s.primaryText}>התחברות</Text></Pressable>
    </SafeAreaView>
  );
}

function Home({ client }: { client: any }) {
  const [g, setG] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => client.glance('he').then(setG).catch((e: any) => setErr(e.message)), [client]);
  useEffect(() => { load(); const h = setInterval(load, 15000); return () => clearInterval(h); }, [load]);
  if (!g) return <Text style={s.muted}>{err || 'טוען…'}</Text>;
  return (
    <ScrollView contentContainerStyle={{ gap: 12, padding: 16 }}>
      <View style={[s.core, { borderColor: g.status === 'approval' ? C.amber : C.cyan }]}><Text style={s.coreText}>JARVIS</Text><Text style={s.muted}>{g.status === 'approval' ? 'ממתין לאישור' : 'מוכן'}</Text></View>
      {g.weather && <Card title="מזג אוויר"><Text style={s.big}>{g.weather.t}° · {g.weather.text}</Text></Card>}
      <Card title="האירוע הבא"><Text style={s.text}>{g.nextEvent ? `${g.nextEvent.title} · ${new Date(g.nextEvent.start).toLocaleString('he-IL')}` : 'אין אירועים'}</Text></Card>
      <Card title="משימות">{g.tasks.length ? g.tasks.map((t: any) => <Text key={t.id} style={s.text}>• {t.title}</Text>) : <Text style={s.muted}>אין משימות</Text>}</Card>
      {!!g.bills.length && <Card title="חשבונות">{g.bills.map((b: any, i: number) => <Text key={i} style={[s.text, b.overdue && { color: C.red }]}>• {b.name}{b.overdue ? ' (באיחור)' : ''}</Text>)}</Card>}
      <Card title="התראות"><Text style={s.text}>{g.unread} שלא נקראו</Text></Card>
    </ScrollView>
  );
}

function Chat({ client }: { client: any }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<Msg>>(null);
  const send = async () => {
    const q = text.trim(); if (!q) return;
    setText(''); setMsgs((m) => [...m, { role: 'user', text: q }]); setBusy(true);
    try {
      const t = await client.command(q, 'voice');
      setMsgs((m) => [...m, { role: 'jarvis', text: t.response ?? t.state, meta: t.state }]);
      if (t.response) Speech.speak(t.response.slice(0, 600), { language: /[֐-׿]/.test(t.response) ? 'he-IL' : 'en-US' });
    } catch (e: any) {
      // offline: keep the request and send it when the connection is back
      await client.enqueue('command', { text: q });
      setMsgs((m) => [...m, { role: 'jarvis', text: `אין חיבור. הבקשה נשמרה ותישלח כשהחיבור יחזור. (${e.message})` }]);
    } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList ref={list} data={msgs} keyExtractor={(_, i) => String(i)} contentContainerStyle={{ padding: 16, gap: 8 }} onContentSizeChange={() => list.current?.scrollToEnd()}
        renderItem={({ item }) => <View style={[s.msg, item.role === 'user' ? s.msgUser : s.msgJ]}><Text style={s.text}>{item.text}</Text>{item.meta && <Text style={s.meta}>{item.meta}</Text>}</View>} />
      <View style={s.composer}>
        <TextInput style={[s.input, { flex: 1, marginVertical: 0 }]} value={text} onChangeText={setText} placeholder="שאלו את ג׳ארוויס (או הכתיבו במקלדת)" placeholderTextColor={C.muted} onSubmitEditing={send} />
        <Pressable style={s.primary} onPress={send} disabled={busy}><Text style={s.primaryText}>{busy ? '…' : 'שלח'}</Text></Pressable>
      </View>
      <Pressable onPress={() => Speech.stop()}><Text style={[s.muted, { textAlign: 'center', paddingBottom: 6 }]}>עצור דיבור</Text></Pressable>
    </KeyboardAvoidingView>
  );
}

function Approvals({ client }: { client: any }) {
  const [list, setList] = useState<any[]>([]);
  const load = useCallback(() => client.approvals().then(setList).catch(() => {}), [client]);
  useEffect(() => { load(); const h = setInterval(load, 8000); return () => clearInterval(h); }, [load]);
  const decide = (a: any, d: 'approve' | 'reject') => Alert.alert('אישור פעולה', `${a.summary}\n\n${a.consequences ?? ''}`, [
    { text: 'ביטול', style: 'cancel' },
    { text: d === 'approve' ? 'אשר' : 'דחה', style: d === 'approve' ? 'default' : 'destructive', onPress: async () => { try { const t = await client.decide(a.id, d); Alert.alert('JARVIS', t.response ?? t.state); } catch (e: any) { Alert.alert('JARVIS', e.message); } load(); } },
  ]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {list.length === 0 && <Text style={s.muted}>אין אישורים ממתינים</Text>}
      {list.map((a) => (
        <Card key={a.id} title={`${a.risk} · עד ${new Date(a.expiresAt).toLocaleTimeString('he-IL')}`}>
          <Text style={s.text}>{a.summary}</Text><Text style={s.muted}>{a.consequences}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Pressable style={[s.btn, { borderColor: C.green }]} onPress={() => decide(a, 'approve')}><Text style={{ color: C.green }}>אשר</Text></Pressable>
            <Pressable style={[s.btn, { borderColor: C.red }]} onPress={() => decide(a, 'reject')}><Text style={{ color: C.red }}>דחה</Text></Pressable>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

function Actions({ client }: { client: any }) {
  const [text, setText] = useState('');
  const run = async (action: string, extra: object = {}) => {
    try { const r = await client.request('/api/watch/action', { method: 'POST', body: { action, text, ...extra } }); Alert.alert('JARVIS', r.response ?? r.status); setText(''); }
    catch { const map: any = { add_reminder: 'reminder.create', add_task: 'task.create', shopping_add: 'shopping.add' };
      if (map[action]) { await client.enqueue(map[action], action === 'shopping_add' ? { item: text } : action === 'add_task' ? { title: text } : { text, at: new Date(Date.now() + 36e5).toISOString() }); Alert.alert('JARVIS', 'נשמר במצב לא מקוון'); } }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
      <TextInput style={s.input} value={text} onChangeText={setText} placeholder="טקסט לפעולה" placeholderTextColor={C.muted} />
      {[['add_task', 'הוסף משימה'], ['add_reminder', 'תזכורת בעוד שעה'], ['shopping_add', 'הוסף לקניות'], ['voice_note', 'שמור פתק'], ['ask', 'שאל את ג׳ארוויס']].map(([a, l]) => (
        <Pressable key={a} style={s.btnWide} onPress={() => run(a)}><Text style={s.text}>{l}</Text></Pressable>
      ))}
      <Pressable style={s.btnWide} onPress={() => run('timer', { minutes: 10 })}><Text style={s.text}>טיימר 10 דקות</Text></Pressable>
      <Pressable style={s.btnWide} onPress={() => client.request('/api/presence', { method: 'POST', body: { state: 'arrived_home' } }).then((r: any) => Alert.alert('JARVIS', `${r.length} אוטומציות הופעלו`))}><Text style={s.text}>הגעתי הביתה</Text></Pressable>
    </ScrollView>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={s.card}><Text style={s.cardTitle}>{title}</Text>{children}</View>;
}

I18nManager.allowRTL(true);
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  brand: { color: C.ice, letterSpacing: 6, fontWeight: '700', textAlign: 'center', paddingVertical: 10, fontSize: 16 },
  text: { color: C.text, fontSize: 15, writingDirection: 'auto' }, muted: { color: C.muted, fontSize: 13, textAlign: 'center', margin: 8 }, big: { color: C.text, fontSize: 22, fontWeight: '600' },
  meta: { color: C.muted, fontSize: 11, marginTop: 4 },
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 14 },
  cardTitle: { color: C.ice, fontSize: 11, letterSpacing: 2, marginBottom: 6 },
  core: { alignSelf: 'center', width: 170, height: 170, borderRadius: 85, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(46,230,255,0.08)', shadowColor: C.cyan, shadowOpacity: 0.8, shadowRadius: 24 },
  coreText: { color: C.ice, fontSize: 24, letterSpacing: 6, fontWeight: '800' },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 12, color: C.text, padding: 12, marginVertical: 6, backgroundColor: 'rgba(0,0,0,0.3)' },
  primary: { backgroundColor: C.cyan, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', marginTop: 6 }, primaryText: { color: '#00121c', fontWeight: '700' },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.line }, tab: { flex: 1, paddingVertical: 12, alignItems: 'center' }, tabOn: { borderTopWidth: 2, borderColor: C.cyan }, tabText: { color: C.muted },
  msg: { padding: 12, borderRadius: 14, maxWidth: '88%' }, msgUser: { alignSelf: 'flex-end', backgroundColor: 'rgba(47,123,255,0.3)' }, msgJ: { alignSelf: 'flex-start', backgroundColor: C.panel, borderWidth: 1, borderColor: C.line },
  composer: { flexDirection: 'row', gap: 8, padding: 10, alignItems: 'center' },
  btn: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16 }, btnWide: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14, backgroundColor: C.panel },
});
