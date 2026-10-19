
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  SafeAreaView,
  View,
  Text,
  Image,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { Link, usePathname } from 'expo-router';

// =====================================
// CONFIG
// =====================================

const API_BASE =
  'https://smart-attendance-api-b3nv.onrender.com';

const REFRESH_INTERVAL = 15000;
const SENSOR_REFRESH_INTERVAL = 30000;
const SENSOR_HISTORY_PERIODS = [
  { hours: 1, label: '1 ชั่วโมง' },
  { hours: 6, label: '6 ชั่วโมง' },
  { hours: 24, label: '24 ชั่วโมง' },
];
const AUDIT_REFRESH_INTERVAL = 30000;
const AUDIT_CATEGORIES = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'attendance', label: 'การเข้าเรียน' },
  { value: 'device', label: 'อุปกรณ์' },
  { value: 'admin', label: 'ผู้ดูแล' },
];
const AUDIT_ACTION_LABELS = {
  scan_success: 'สแกนบัตรสำเร็จ',
  scan_duplicate: 'สแกนซ้ำและถูกปฏิเสธ',
  card_unknown: 'บัตรที่ไม่รู้จักถูกปฏิเสธ',
  device_online: 'อุปกรณ์กลับมาออนไลน์',
  device_offline: 'อุปกรณ์ออฟไลน์',
  attendance_deleted: 'ผู้ดูแลลบประวัติเช็คชื่อ',
  student_deleted: 'ผู้ดูแลลบนักศึกษา',
  student_created: 'ผู้ดูแลเพิ่มนักศึกษา',
  student_updated: 'ผู้ดูแลแก้ไขข้อมูลนักศึกษา',
  course_created: 'ผู้ดูแลเพิ่มรายวิชา',
  course_updated: 'ผู้ดูแลแก้ไขรายวิชา',
  course_deleted: 'ผู้ดูแลลบรายวิชา',
  schedule_created: 'ผู้ดูแลเพิ่มตารางเรียน',
  schedule_updated: 'ผู้ดูแลแก้ไขตารางเรียน',
  schedule_deleted: 'ผู้ดูแลลบตารางเรียน',
  checkin_rejected: 'ปฏิเสธการเช็คชื่อนอกช่วงเวลาหรือมีตารางทับซ้อน',
};

const INITIAL_STUDENTS = [
  {
    studentId: '69409010003',
    name: 'Sakareeya Mandaenghe',
  },
  {
    studentId: '694090001',
    name: 'Kamal Jehmi',
  },
  {
    studentId: '694090002',
    name: 'Khanctitpol Phengeiat',
  },
];

const C = {
  navy: '#12385D',
  blue: '#1677D2',
  bg: '#F2F6FA',
  white: '#FFFFFF',
  text: '#1E2E40',
  muted: '#64758B',
  border: '#E1E9F1',
  green: '#16845B',
  greenBg: '#E8F7EF',
  red: '#C0392B',
  redBg: '#FCEEEE',
  orange: '#A65D03',
  orangeBg: '#FFF3DE',
};

// =====================================
// HELPERS
// =====================================

function getBangkokDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(value) {
  if (!value) return '-';

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  return match
    ? `${match[3]}/${match[2]}/${match[1]}`
    : String(value);
}

function getPeriodRange(date, period) {
  const selected = new Date(`${date}T00:00:00Z`);
  const start = new Date(selected);
  const end = new Date(selected);

  if (period === 'week') {
    const daysFromMonday = (selected.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysFromMonday);
    end.setUTCDate(start.getUTCDate() + 6);
  } else if (period === 'month') {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  }

  const toDateString = value =>
    value.toISOString().slice(0, 10);

  return {
    start: toDateString(start),
    end: toDateString(end),
  };
}

function isAttendedStatus(status) {
  return status === 'present' || status === 'late';
}

function getAttendanceStatusLabel(status) {
  if (status === 'present') return 'มาเรียน';
  if (status === 'late') return 'มาสาย';
  return status || 'ไม่ระบุ';
}


function escapeCsvCell(value) {
  const cell = String(value ?? '');
  const safeCell = /^[=+\-@\t\r]/.test(cell) ? "'" + cell : cell;
  return '"' + safeCell.replace(/"/g, '""') + '"';
}

async function readJsonApiResponse(response, label) {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.toLowerCase().includes('application/json')) {
    if (response.status === 404) {
      throw new Error(
        `ไม่พบ API ${label} (404) กรุณารีสตาร์ต Backend จากโฟลเดอร์ attendance-api`
      );
    }

    throw new Error(
      `API ${label} ตอบกลับข้อมูลที่ไม่ใช่ JSON (HTTP ${response.status})`
    );
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`API ${label} ส่ง JSON ที่ไม่ถูกต้อง`);
  }
}

function formatTime(value) {
  if (!value) return '-';

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getRecordKey(item, index = 0) {
  return String(
    item.id ||
    [
      item.studentId || '',
      item.attendanceDate || '',
      item.receivedAt || item.timestamp || index,
    ].join('-')
  );
}

function normalizeStudent(student) {
  return {
    ...student,
    studentId: String(
      student.studentId || student.id || ''
    ),
    name: String(student.name || 'ไม่ระบุชื่อ'),
  };
}

// =====================================
// WEB TEXT-TO-SPEECH
// =====================================

// ชื่อภาษาไทยสำหรับอ่านออกเสียงบนเว็บ
// ใช้ nameThai จาก API ก่อน หากไม่มีจะลองจับคู่จากรหัสนักศึกษา
const THAI_SPOKEN_NAMES = {
  '69409010003': 'ซาการียา ม่านแดงเห่',
  '694090001': 'กามาล เจะหมิ',
  '694090002': 'ครรชิตพล เพ็งเอียด',
};

function getThaiSpokenName(item) {
  const studentId = String(item?.studentId || '').trim();
  const thaiName = String(item?.nameThai || '').trim();

  if (thaiName) return thaiName;
  if (THAI_SPOKEN_NAMES[studentId]) return THAI_SPOKEN_NAMES[studentId];

  // หากไม่มีชื่อไทยที่กำหนดไว้ จะใช้ชื่อจาก API เป็นทางเลือกสุดท้าย
  return String(item?.name || '').trim();
}

function speakAttendance(name) {
  if (
    Platform.OS !== 'web' ||
    typeof window === 'undefined' ||
    !window.speechSynthesis ||
    typeof window.SpeechSynthesisUtterance === 'undefined'
  ) {
    return;
  }

  const fullName = String(name || '').trim();
  if (!fullName) return;

  // หยุดเสียงก่อนหน้า เพื่อไม่ให้เสียงอ่านซ้อนกัน
  window.speechSynthesis.cancel();

  const utterance = new window.SpeechSynthesisUtterance(
    `${fullName} เช็คชื่อแล้ว`
  );

  utterance.lang = 'th-TH';
  utterance.rate = 0.9;
  utterance.pitch = 1;
  utterance.volume = 1;

  // เลือกเสียงภาษาไทยเมื่อเบราว์เซอร์มีให้ใช้งาน
  const voices = window.speechSynthesis.getVoices();
  const thaiVoice = voices.find(voice =>
    String(voice.lang || '').toLowerCase().startsWith('th')
  );
  if (thaiVoice) utterance.voice = thaiVoice;

  window.speechSynthesis.speak(utterance);
}

// =====================================
// SMALL COMPONENTS
// =====================================

function SectionTitle({ title, subtitle, right }) {
  return (
    <View style={styles.sectionHeading}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {!!subtitle && (
          <Text style={styles.subtitle}>{subtitle}</Text>
        )}
      </View>
      {right}
    </View>
  );
}

function StatCard({ label, value, note, accent }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statAccent, { backgroundColor: accent }]} />
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statNote}>{note}</Text>
    </View>
  );
}

function ActionButton({
  title,
  onPress,
  active,
  disabled,
  danger,
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        active && styles.buttonActive,
        danger && styles.buttonDanger,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          active && styles.buttonTextActive,
          danger && styles.buttonTextActive,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

// =====================================
// MAIN APP
// =====================================

const APP_PAGES = [
  { path: '/', title: 'ภาพรวม', shortTitle: 'สรุป' },
  { path: '/attendance', title: 'เข้าเรียน', shortTitle: 'เข้าเรียน' },
  { path: '/management', title: 'จัดการ', shortTitle: 'จัดการ' },
  { path: '/devices', title: 'อุปกรณ์', shortTitle: 'อุปกรณ์' },
  { path: '/sensors', title: 'เซนเซอร์', shortTitle: 'เซนเซอร์' },
  { path: '/audit', title: 'Audit Log', shortTitle: 'บันทึก' },
];

const WEEKDAY_OPTIONS = [
  { value: '0', label: 'อาทิตย์' },
  { value: '1', label: 'จันทร์' },
  { value: '2', label: 'อังคาร' },
  { value: '3', label: 'พุธ' },
  { value: '4', label: 'พฤหัสบดี' },
  { value: '5', label: 'ศุกร์' },
  { value: '6', label: 'เสาร์' },
];
const LATE_AFTER_OPTIONS = [10, 15, 20];

export default function App({ children }) {
  const pathname = usePathname();
  const activePage =
    APP_PAGES.find(page => page.path === pathname)?.path || '/';
  const { width } = useWindowDimensions();
  const isMobile = width < 700;
  const sensorAlertPlayer = useAudioPlayer(
    require('./assets/sensor-alert.wav')
  );

  const [records, setRecords] = useState([]);
  const [students, setStudents] = useState(INITIAL_STUDENTS);
  const [courses, setCourses] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [managementLoading, setManagementLoading] = useState(false);
  const [managementError, setManagementError] = useState('');
  const [managementSaving, setManagementSaving] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState('');
  const [studentForm, setStudentForm] = useState({
    studentId: '',
    name: '',
    uid: '',
  });
  const [editingCourseId, setEditingCourseId] = useState('');
  const [courseForm, setCourseForm] = useState({
    courseCode: '',
    courseName: '',
    room: '',
    semester: '',
  });
  const [editingScheduleId, setEditingScheduleId] = useState('');
  const [scheduleForm, setScheduleForm] = useState({
    courseId: '',
    weekday: '1',
    opensAt: '08:00',
    closesAt: '09:00',
    lateAfterMinutes: 10,
  });
  const [date, setDate] = useState(getBangkokDate);
  const [search, setSearch] = useState('');
  const [showAllDates, setShowAllDates] = useState(false);
  const [analyticsPeriod, setAnalyticsPeriod] = useState('day');
  const [exportingReport, setExportingReport] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [studentsLoading, setStudentsLoading] = useState(false);

  const [error, setError] = useState('');
  const [studentsError, setStudentsError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [deletingId, setDeletingId] = useState('');

  const [lastUpdated, setLastUpdated] = useState('');

  // สถานะตรวจสอบอุปกรณ์ ESP32
  const [devices, setDevices] = useState([]);
  const [deviceEvents, setDeviceEvents] = useState([]);
  const [deviceEventError, setDeviceEventError] = useState('');
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLogError, setAuditLogError] = useState('');
  const [auditLogSearch, setAuditLogSearch] = useState('');
  const [auditCategory, setAuditCategory] = useState('all');
  const [offlineThresholdInput, setOfflineThresholdInput] = useState('5');
  const [deviceLoading, setDeviceLoading] = useState(true);
  const [deviceRefreshing, setDeviceRefreshing] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const [deviceLastUpdated, setDeviceLastUpdated] = useState('');
  const [sensorHistory, setSensorHistory] = useState([]);
  const [sensorPeriodHours, setSensorPeriodHours] = useState(1);
  const [temperatureThreshold, setTemperatureThreshold] = useState('35');
  const [temperatureThresholdSaving, setTemperatureThresholdSaving] = useState(false);
  const [temperatureThresholdStatus, setTemperatureThresholdStatus] = useState('');
  const [humidityThreshold, setHumidityThreshold] = useState('80');
  const [sensorSoundEnabled, setSensorSoundEnabled] = useState(true);
  const [sensorSoundError, setSensorSoundError] = useState('');
  const [sensorLoading, setSensorLoading] = useState(true);
  const [sensorError, setSensorError] = useState('');
  const [sensorLastUpdated, setSensorLastUpdated] = useState('');



  const seenRecords = useRef(new Set());
  const firstLoadComplete = useRef(false);
  const requestNumber = useRef(0);
  const sensorRequestNumber = useRef(0);
  const lastSensorAlertSoundKey = useRef('');

  // =====================================
  // LOAD ATTENDANCE
  // =====================================

  const loadAttendance = useCallback(
    async (
      selectedDate = date,
      allDates = showAllDates,
      manual = false
    ) => {
      const currentRequest = ++requestNumber.current;

      if (manual) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError('');

      try {
        const query = allDates
          ? ''
          : `?date=${encodeURIComponent(selectedDate)}`;

        const response = await fetch(
          `${API_BASE}/api/attendance${query}`
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(
            result.message || `HTTP ${response.status}`
          );
        }

        const data = Array.isArray(result.data)
          ? result.data
          : [];

        data.sort((a, b) => {
          const timeA = Number(
            a.timestamp ||
            new Date(a.receivedAt || 0).getTime() ||
            0
          );

          const timeB = Number(
            b.timestamp ||
            new Date(b.receivedAt || 0).getTime() ||
            0
          );

          return timeB - timeA;
        });

        if (currentRequest !== requestNumber.current) {
          return;
        }

        const now = Date.now();
        const newlyArrived = [];

        data.forEach((item, index) => {
          const key = getRecordKey(item, index);

          if (seenRecords.current.has(key)) {
            return;
          }

          seenRecords.current.add(key);

          if (!firstLoadComplete.current) {
            return;
          }

          const receivedTime = Number(
            item.timestamp ||
            new Date(item.receivedAt || 0).getTime() ||
            0
          );

          const isRecent =
            receivedTime > 0 &&
            now - receivedTime >= 0 &&
            now - receivedTime <= 60000;

          if (isAttendedStatus(item.status) && isRecent) {
            newlyArrived.push(item);
          }
        });

        if (!firstLoadComplete.current) {
          firstLoadComplete.current = true;
        } else if (
          Platform.OS === 'web' &&
          !allDates &&
          selectedDate === getBangkokDate()
        ) {
          newlyArrived.reverse().forEach(item => {
            speakAttendance(getThaiSpokenName(item));
          });
        }

        setRecords(data);

        setLastUpdated(
          new Date().toLocaleTimeString('th-TH', {
            timeZone: 'Asia/Bangkok',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          })
        );
      } catch (e) {
        if (currentRequest === requestNumber.current) {
          setError(`เชื่อมต่อ API ไม่สำเร็จ: ${e.message}`);
        }
      } finally {
        if (currentRequest === requestNumber.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [date, showAllDates]
  );

  // =====================================
  // LOAD STUDENTS
  // =====================================

  const loadStudents = useCallback(async () => {
    setStudentsLoading(true);
    setStudentsError('');

    try {
      const response = await fetch(`${API_BASE}/api/students`);
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || `HTTP ${response.status}`
        );
      }

      const data = Array.isArray(result.data)
        ? result.data.map(normalizeStudent)
        : [];

      setStudents(data);
    } catch (e) {
      setStudentsError(e.message);
      setStudents(INITIAL_STUDENTS);
    } finally {
      setStudentsLoading(false);
    }
  }, []);

  const loadManagementData = useCallback(async () => {
    setManagementLoading(true);
    setManagementError('');

    try {
      const [courseResponse, scheduleResponse] = await Promise.all([
        fetch(`${API_BASE}/api/courses`),
        fetch(`${API_BASE}/api/schedules`),
      ]);
      const [courseResult, scheduleResult] = await Promise.all([
        readJsonApiResponse(courseResponse, 'รายวิชา'),
        readJsonApiResponse(scheduleResponse, 'ตารางเรียน'),
      ]);

      if (!courseResponse.ok || !courseResult.success) {
        throw new Error(
          courseResult.message || `HTTP ${courseResponse.status}`
        );
      }
      if (!scheduleResponse.ok || !scheduleResult.success) {
        throw new Error(
          scheduleResult.message || `HTTP ${scheduleResponse.status}`
        );
      }

      setCourses(Array.isArray(courseResult.data) ? courseResult.data : []);
      setSchedules(
        Array.isArray(scheduleResult.data) ? scheduleResult.data : []
      );
    } catch (e) {
      setManagementError(`โหลดข้อมูลจัดการไม่สำเร็จ: ${e.message}`);
    } finally {
      setManagementLoading(false);
    }
  }, []);

  // =====================================
  // LOAD ESP32 DEVICE STATUS
  // =====================================

  const loadDeviceEvents = useCallback(async () => {
    setDeviceEventError('');

    try {
      const response = await fetch(`${API_BASE}/api/device-events?limit=20`);
      const result = await readJsonApiResponse(response, 'ประวัติเหตุการณ์');

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || `HTTP ${response.status}`
        );
      }

      setDeviceEvents(Array.isArray(result.data) ? result.data : []);
    } catch (e) {
      setDeviceEventError(
        `โหลดประวัติเหตุการณ์ไม่สำเร็จ: ${e.message}`
      );
    }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    setAuditLogError('');

    try {
      const response = await fetch(`${API_BASE}/api/audit-logs?limit=100`);
      const result = await readJsonApiResponse(response, 'Audit Log');

      if (!response.ok || !result.success) {
        throw new Error(result.message || `HTTP ${response.status}`);
      }

      setAuditLogs(Array.isArray(result.data) ? result.data : []);
    } catch (e) {
      setAuditLogError(`โหลด Audit Log ไม่สำเร็จ: ${e.message}`);
    }
  }, []);

  const loadDevices = useCallback(async (manual = false) => {
    if (manual) {
      setDeviceRefreshing(true);
    }

    setDeviceError('');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(`${API_BASE}/api/devices`, {
        signal: controller.signal,
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || `HTTP ${response.status}`
        );
      }

      setDevices(
        Array.isArray(result.data) ? result.data : []
      );
      void loadDeviceEvents();

      setDeviceLastUpdated(
        new Date().toLocaleTimeString('th-TH', {
          timeZone: 'Asia/Bangkok',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      );
    } catch (e) {
      setDeviceError(
        e.name === 'AbortError'
          ? 'หมดเวลารอ API กรุณาตรวจสอบ Backend และการเชื่อมต่อเครือข่าย'
          : e.message || 'ไม่สามารถเชื่อมต่อ API ได้'
      );
    } finally {
      clearTimeout(timeoutId);
      setDeviceLoading(false);
      setDeviceRefreshing(false);
    }
  }, [loadDeviceEvents]);

  // =====================================
  const loadSensorHistory = useCallback(async () => {
    const currentRequest = ++sensorRequestNumber.current;
    setSensorError('');
    setSensorLoading(true);

    try {
      const response = await fetch(
        `${API_BASE}/api/sensors/dht11?hours=${sensorPeriodHours}`
      );
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || `HTTP ${response.status}`);
      const data = Array.isArray(result.data) ? result.data : [];
      data.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
      if (currentRequest !== sensorRequestNumber.current) return;

      setSensorHistory(data);
      setSensorLastUpdated(new Date().toLocaleTimeString('th-TH', {
        timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }));
    } catch (e) {
      if (currentRequest === sensorRequestNumber.current) {
        setSensorError(`โหลดข้อมูล DHT11 ไม่สำเร็จ: ${e.message}`);
      }
    } finally {
      if (currentRequest === sensorRequestNumber.current) {
        setSensorLoading(false);
      }
    }
  }, [sensorPeriodHours]);

  // DELETE ATTENDANCE
  // =====================================

  const deleteAttendance = async item => {
    const studentId = String(item.studentId || '').trim();
    const attendanceDate = String(
      item.attendanceDate || date
    ).trim();

    if (!studentId || !attendanceDate) {
      setActionError('ไม่พบรหัสนักศึกษาหรือวันที่ของรายการนี้');
      setActionMessage('');
      return;
    }

    if (Platform.OS === 'web') {
      const confirmed = window.confirm(
        `ยืนยันลบประวัติเช็คชื่อของ ${item.name || studentId} วันที่ ${formatDate(attendanceDate)}?\n\nการลบนี้ทำให้แตะบัตรเพื่อเช็คชื่อใหม่ได้`
      );

      if (!confirmed) return;
    }

    const lockKey = `attendance-${studentId}-${attendanceDate}`;

    setDeletingId(lockKey);
    setActionMessage('');
    setActionError('');

    try {
      const response = await fetch(
        `${API_BASE}/api/attendance/${encodeURIComponent(studentId)}?date=${encodeURIComponent(attendanceDate)}${item.courseId ? `&courseId=${encodeURIComponent(item.courseId)}` : ''}`,
        { method: 'DELETE' }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || `HTTP ${response.status}`
        );
      }

      setActionMessage(
        result.auditLogged === false
          ? `ลบประวัติของ ${item.name || studentId} แล้ว แต่บันทึก Audit Log ไม่สำเร็จ`
          : `ลบประวัติของ ${item.name || studentId} แล้ว สามารถแตะบัตรใหม่ได้`
      );

      seenRecords.current.delete(getRecordKey(item));

      void loadAuditLogs();
      await loadAttendance(date, showAllDates, true);
    } catch (e) {
      setActionError(`ลบประวัติไม่สำเร็จ: ${e.message}`);
    } finally {
      setDeletingId('');
    }
  };

  // =====================================
  // DELETE STUDENT
  // =====================================

  const deleteStudent = async student => {
    const studentId = String(
      student.studentId || student.id || ''
    ).trim();

    if (!studentId) {
      setActionError('ไม่พบรหัสนักศึกษาสำหรับลบ');
      setActionMessage('');
      return;
    }

    if (Platform.OS === 'web') {
      const confirmed = window.confirm(
        `ยืนยันลบนักศึกษา ${student.name || studentId} (${studentId}) ออกจากรายชื่อ?\n\nประวัติเช็คชื่อเก่าจะไม่ถูกลบ`
      );

      if (!confirmed) return;
    }

    setDeletingId(`student-${studentId}`);
    setActionMessage('');
    setActionError('');

    try {
      const response = await fetch(
        `${API_BASE}/api/students/${encodeURIComponent(studentId)}`,
        { method: 'DELETE' }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
          `HTTP ${response.status}. ตรวจสอบว่ามีนักศึกษาคนนี้ใน Firebase students หรือไม่`
        );
      }

      setActionMessage(
        result.auditLogged === false
          ? `ลบนักศึกษา ${student.name || studentId} แล้ว แต่บันทึก Audit Log ไม่สำเร็จ`
          : `ลบนักศึกษา ${student.name || studentId} ออกจากรายชื่อแล้ว`
      );

      void loadAuditLogs();
      await loadStudents();
    } catch (e) {
      setActionError(`ลบนักศึกษาไม่สำเร็จ: ${e.message}`);
    } finally {
      setDeletingId('');
    }
  };

  const resetStudentForm = () => {
    setEditingStudentId('');
    setStudentForm({ studentId: '', name: '', uid: '' });
  };

  const saveStudent = async () => {
    setManagementSaving(true);
    setActionMessage('');
    setActionError('');
    try {
      const response = await fetch(
        editingStudentId
          ? `${API_BASE}/api/students/${encodeURIComponent(editingStudentId)}`
          : `${API_BASE}/api/students`,
        {
          method: editingStudentId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(studentForm),
        }
      );
      const result = await readJsonApiResponse(response, 'นักศึกษา');
      if (!response.ok || !result.success) {
        throw new Error(result.message || `HTTP ${response.status}`);
      }

      setActionMessage(
        editingStudentId ? 'บันทึกการแก้ไขนักศึกษาแล้ว' : 'เพิ่มนักศึกษาแล้ว'
      );
      resetStudentForm();
      await loadStudents();
      void loadAuditLogs();
    } catch (e) {
      setActionError(`บันทึกนักศึกษาไม่สำเร็จ: ${e.message}`);
    } finally {
      setManagementSaving(false);
    }
  };

  const saveCourse = async () => {
    setManagementSaving(true);
    setActionMessage('');
    setActionError('');
    try {
      const response = await fetch(
        editingCourseId
          ? `${API_BASE}/api/courses/${encodeURIComponent(editingCourseId)}`
          : `${API_BASE}/api/courses`,
        {
          method: editingCourseId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(courseForm),
        }
      );
      const result = await readJsonApiResponse(response, 'รายวิชา');
      if (!response.ok || !result.success) {
        throw new Error(result.message || `HTTP ${response.status}`);
      }

      setActionMessage(
        editingCourseId ? 'บันทึกการแก้ไขรายวิชาแล้ว' : 'เพิ่มรายวิชาแล้ว'
      );
      setEditingCourseId('');
      setCourseForm({
        courseCode: '',
        courseName: '',
        room: '',
        semester: '',
      });
      await loadManagementData();
      void loadAuditLogs();
    } catch (e) {
      setActionError(`บันทึกรายวิชาไม่สำเร็จ: ${e.message}`);
    } finally {
      setManagementSaving(false);
    }
  };

  const saveSchedule = async () => {
    setManagementSaving(true);
    setActionMessage('');
    setActionError('');
    try {
      const response = await fetch(
        editingScheduleId
          ? `${API_BASE}/api/schedules/${encodeURIComponent(editingScheduleId)}`
          : `${API_BASE}/api/schedules`,
        {
          method: editingScheduleId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scheduleForm),
        }
      );
      const result = await readJsonApiResponse(response, 'ตารางเรียน');
      if (!response.ok || !result.success) {
        throw new Error(result.message || `HTTP ${response.status}`);
      }

      setActionMessage(
        editingScheduleId
          ? 'บันทึกการแก้ไขคาบเรียนแล้ว'
          : 'เพิ่มคาบเรียนแล้ว'
      );
      setEditingScheduleId('');
      setScheduleForm({
        courseId: '',
        weekday: '1',
        opensAt: '08:00',
        closesAt: '09:00',
        lateAfterMinutes: 10,
      });
      await loadManagementData();
      void loadAuditLogs();
    } catch (e) {
      setActionError(`บันทึกตารางเรียนไม่สำเร็จ: ${e.message}`);
    } finally {
      setManagementSaving(false);
    }
  };

  const deleteManagedRecord = async (kind, id, label) => {
    if (Platform.OS === 'web' && !window.confirm(`ยืนยันลบ${label}?`)) {
      return;
    }

    setManagementSaving(true);
    setActionMessage('');
    setActionError('');
    try {
      const response = await fetch(
        `${API_BASE}/api/${kind}/${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      const result = await readJsonApiResponse(response, label);
      if (!response.ok || !result.success) {
        throw new Error(result.message || `HTTP ${response.status}`);
      }
      setActionMessage(`ลบ${label}แล้ว`);
      await loadManagementData();
      void loadAuditLogs();
    } catch (e) {
      setActionError(`ลบ${label}ไม่สำเร็จ: ${e.message}`);
    } finally {
      setManagementSaving(false);
    }
  };

  // =====================================
  // TEMPERATURE ALERT SETTINGS (Firebase API)
  // =====================================

  const loadTemperatureAlertSettings = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/settings/temperature-alert`);
      const result = await readJsonApiResponse(response, 'ตั้งค่าแจ้งเตือนอุณหภูมิ');
      if (!response.ok || !result.success) {
        throw new Error(result.message || `HTTP ${response.status}`);
      }
      const threshold = Number(result.data?.threshold);
      if (Number.isFinite(threshold) && threshold >= 20 && threshold <= 50) {
        setTemperatureThreshold(String(threshold));
      }
      setTemperatureThresholdStatus('โหลดเกณฑ์อุณหภูมิจาก Firebase แล้ว');
    } catch (e) {
      setTemperatureThresholdStatus(`โหลดเกณฑ์จาก Firebase ไม่สำเร็จ: ${e.message}`);
    }
  }, []);

  const saveTemperatureAlertSettings = useCallback(async () => {
    const threshold = Number(temperatureThreshold);
    if (!temperatureThreshold.trim() || !Number.isFinite(threshold) || threshold < 20 || threshold > 50) {
      setTemperatureThresholdStatus('กรุณาใส่อุณหภูมิระหว่าง 20-50 °C');
      return;
    }
    setTemperatureThresholdSaving(true);
    setTemperatureThresholdStatus('');
    try {
      const response = await fetch(`${API_BASE}/api/settings/temperature-alert`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold }),
      });
      const result = await readJsonApiResponse(response, 'บันทึกเกณฑ์แจ้งเตือนอุณหภูมิ');
      if (!response.ok || !result.success) {
        throw new Error(result.message || `HTTP ${response.status}`);
      }
      setTemperatureThreshold(String(result.data?.threshold ?? threshold));
      setTemperatureThresholdStatus('บันทึกเกณฑ์อุณหภูมิลง Firebase แล้ว');
      void loadAuditLogs();
    } catch (e) {
      setTemperatureThresholdStatus(`บันทึกไม่สำเร็จ: ${e.message}`);
    } finally {
      setTemperatureThresholdSaving(false);
    }
  }, [temperatureThreshold, loadAuditLogs]);

  // =====================================
  // EFFECTS
  // =====================================

  useEffect(() => {
    void loadTemperatureAlertSettings();
  }, [loadTemperatureAlertSettings]);

  useEffect(() => {
    void loadAttendance(date, showAllDates);
  }, [date, showAllDates, loadAttendance]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadAttendance(date, showAllDates);
    }, REFRESH_INTERVAL);

    return () => clearInterval(timer);
  }, [date, showAllDates, loadAttendance]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  useEffect(() => {
    void loadManagementData();
  }, [loadManagementData]);

  useEffect(() => {
    void loadAuditLogs();
    const timer = setInterval(
      () => void loadAuditLogs(),
      AUDIT_REFRESH_INTERVAL
    );
    return () => clearInterval(timer);
  }, [loadAuditLogs]);

  // โหลดสถานะอุปกรณ์และอัปเดตทุก 15 วินาที
  useEffect(() => {
    void loadDevices();

    const timer = setInterval(() => {
      void loadDevices();
    }, REFRESH_INTERVAL);

    return () => clearInterval(timer);
  }, [loadDevices]);

  // =====================================
  // โหลดประวัติเซนเซอร์ทุก 30 วินาที
  useEffect(() => {
    void loadSensorHistory();
    const timer = setInterval(
      () => void loadSensorHistory(),
      SENSOR_REFRESH_INTERVAL
    );
    return () => clearInterval(timer);
  }, [loadSensorHistory]);

  const temperatureLimit = Number(temperatureThreshold);
  const humidityLimit = Number(humidityThreshold);
  const validTemperatureThreshold =
    temperatureThreshold.trim() !== '' &&
    Number.isFinite(temperatureLimit) &&
    temperatureLimit >= 20 &&
    temperatureLimit <= 50;
  const validHumidityThreshold =
    humidityThreshold.trim() !== '' &&
    Number.isFinite(humidityLimit) &&
    humidityLimit >= 0 &&
    humidityLimit <= 100;

  const sensorChartData = useMemo(() => {
    const chronological = [...sensorHistory].reverse();
    const pointLimit = 30;

    if (chronological.length <= pointLimit) return chronological;

    return Array.from({ length: pointLimit }, (_, index) => {
      const sourceIndex = Math.round(
        (index * (chronological.length - 1)) / (pointLimit - 1)
      );
      return chronological[sourceIndex];
    });
  }, [sensorHistory]);

  const abnormalSensorHistory = useMemo(
    () =>
      sensorHistory.filter(item => {
        const temperature = Number(item.temperature);
        const humidity = Number(item.humidity);
        const temperatureAbnormal =
          validTemperatureThreshold &&
          Number.isFinite(temperature) &&
          temperature > temperatureLimit;
        const humidityAbnormal =
          validHumidityThreshold &&
          Number.isFinite(humidity) &&
          humidity > humidityLimit;

        return temperatureAbnormal || humidityAbnormal;
      }),
    [
      humidityLimit,
      sensorHistory,
      temperatureLimit,
      validHumidityThreshold,
      validTemperatureThreshold,
    ]
  );

  const latestSensor = sensorHistory[0];
  const latestTemperatureAlert =
    latestSensor &&
    validTemperatureThreshold &&
    Number(latestSensor.temperature) > temperatureLimit;
  const latestHumidityAlert =
    latestSensor &&
    validHumidityThreshold &&
    Number(latestSensor.humidity) > humidityLimit;

  const playSensorAlertSound = useCallback(() => {
    setSensorSoundError('');

    try {
      void sensorAlertPlayer
        .seekTo(0)
        .then(() => sensorAlertPlayer.play())
        .catch(error => {
          setSensorSoundError(`เล่นเสียงเตือนไม่สำเร็จ: ${error.message}`);
        });
    } catch (error) {
      setSensorSoundError(`เล่นเสียงเตือนไม่สำเร็จ: ${error.message}`);
    }
  }, [sensorAlertPlayer]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    }).catch(error => {
      setSensorSoundError(`ตั้งค่าเสียงแจ้งเตือนไม่สำเร็จ: ${error.message}`);
    });
  }, []);

  useEffect(() => {
    if (!latestSensor || (!latestTemperatureAlert && !latestHumidityAlert)) {
      return;
    }

    const alertKey = [
      latestSensor.id || latestSensor.timestamp,
      latestTemperatureAlert ? 'temperature' : '',
      latestHumidityAlert ? 'humidity' : '',
    ].join(':');

    if (lastSensorAlertSoundKey.current === alertKey) return;
    lastSensorAlertSoundKey.current = alertKey;

    if (sensorSoundEnabled) {
      playSensorAlertSound();
    }
  }, [
    latestHumidityAlert,
    latestSensor,
    latestTemperatureAlert,
    playSensorAlertSound,
    sensorSoundEnabled,
  ]);

  // FILTERS AND STATS
  // =====================================

  const periodRange = useMemo(
    () => getPeriodRange(date, analyticsPeriod),
    [date, analyticsPeriod]
  );

  const periodRecords = useMemo(
    () =>
      records.filter(item => {
        const recordDate = String(item.attendanceDate || '');
        return (
          recordDate >= periodRange.start &&
          recordDate <= periodRange.end
        );
      }),
    [records, periodRange]
  );

  const sessionDates = useMemo(
    () =>
      [...new Set(
        periodRecords
          .map(item => String(item.attendanceDate || ''))
          .filter(Boolean)
      )].sort(),
    [periodRecords]
  );

  const sessionKeys = useMemo(
    () =>
      new Set(
        periodRecords
          .filter(item => item.attendanceDate)
          .map(item =>
            item.courseId
              ? `${item.attendanceDate}:${item.courseId}`
              : String(item.attendanceDate)
          )
      ),
    [periodRecords]
  );
  const sessionCount = sessionKeys.size;

  const studentAttendance = useMemo(() => {
    const presentByStudent = new Map();

    periodRecords.forEach(item => {
      if (!isAttendedStatus(item.status) || !item.studentId) return;

      const studentId = String(item.studentId);
      const sessions = presentByStudent.get(studentId) || new Set();
      sessions.add(
        item.courseId
          ? `${item.attendanceDate}:${item.courseId}`
          : String(item.attendanceDate || '')
      );
      presentByStudent.set(studentId, sessions);
    });

    return students.map(student => {
      const attendedSessions =
        presentByStudent.get(String(student.studentId)) || new Set();
      const attendedCount = attendedSessions.size;
      const attendanceRate = sessionCount
        ? Math.round((attendedCount / sessionCount) * 100)
        : 0;

      return {
        ...student,
        attendedCount,
        absentCount: Math.max(0, sessionCount - attendedCount),
        attendanceRate,
      };
    });
  }, [periodRecords, sessionCount, students]);

  const courseAttendance = useMemo(() => {
    const courseStats = new Map();
    const coursesById = new Map(
      courses.map(course => [String(course.id), course])
    );
    const coursesByCode = new Map(
      courses
        .filter(course => course.courseCode)
        .map(course => [String(course.courseCode).toLowerCase(), course])
    );

    courses.forEach(course => {
      const key = `course:${course.id}`;
      courseStats.set(key, {
        key,
        courseCode: String(course.courseCode || ''),
        courseName: String(course.courseName || 'ไม่ระบุชื่อรายวิชา'),
        sessions: new Set(),
        attended: new Set(),
      });
    });

    periodRecords.forEach(item => {
      const courseId = String(item.courseId || '');
      const course =
        coursesById.get(courseId) ||
        coursesByCode.get(String(item.courseCode || '').toLowerCase());
      const key = course
        ? `course:${course.id}`
        : courseId
          ? `course:${courseId}`
          : `legacy:${item.courseCode || item.courseName || 'unspecified'}`;

      if (!courseStats.has(key)) {
        courseStats.set(key, {
          key,
          courseCode: String(item.courseCode || ''),
          courseName: String(item.courseName || 'ไม่ระบุรายวิชา'),
          sessions: new Set(),
          attended: new Set(),
        });
      }

      const stats = courseStats.get(key);
      const attendanceDate = String(item.attendanceDate || '');
      if (attendanceDate) stats.sessions.add(attendanceDate);
      if (
        isAttendedStatus(item.status) &&
        item.studentId &&
        attendanceDate
      ) {
        stats.attended.add(`${attendanceDate}:${item.studentId}`);
      }
    });

    return [...courseStats.values()]
      .map(course => {
        const attendedCount = course.attended.size;
        const expectedCount = students.length * course.sessions.size;
        const absentStudentIds = new Set();

        course.sessions.forEach(attendanceDate => {
          students.forEach(student => {
            if (
              !course.attended.has(
                `${attendanceDate}:${String(student.studentId)}`
              )
            ) {
              absentStudentIds.add(String(student.studentId));
            }
          });
        });

        return {
          ...course,
          sessionCount: course.sessions.size,
          attendedCount,
          absentCount: Math.max(0, expectedCount - attendedCount),
          absentStudentCount: absentStudentIds.size,
          attendanceRate: expectedCount
            ? Math.round((attendedCount / expectedCount) * 100)
            : null,
        };
      })
      .sort((a, b) =>
        a.courseName.localeCompare(b.courseName, 'th')
      );
  }, [courses, periodRecords, students]);

  const totalPresent = studentAttendance.reduce(
    (total, student) => total + student.attendedCount,
    0
  );
  const expectedAttendances = students.length * sessionCount;
  const overallAttendanceRate = expectedAttendances
    ? Math.round((totalPresent / expectedAttendances) * 100)
    : 0;
  const absentCount = sessionCount
    ? Math.max(0, expectedAttendances - totalPresent)
    : '-';
  const absentStudentCount = studentAttendance.filter(
    student => student.absentCount > 0
  ).length;
  const presentCount = studentAttendance.filter(
    student => student.attendedCount > 0
  ).length;
  const offlineThresholdMinutes = Number(offlineThresholdInput);
  const validOfflineThreshold =
    Number.isFinite(offlineThresholdMinutes) &&
    offlineThresholdMinutes >= 1 &&
    offlineThresholdMinutes <= 1440;
  const longOfflineDevices = validOfflineThreshold
    ? devices.filter(
        device =>
          !device.online &&
          Number(device.offlineDurationMs || 0) >=
            offlineThresholdMinutes * 60 * 1000
      )
    : [];
  const filteredAuditLogs = useMemo(() => {
    const query = auditLogSearch.trim().toLowerCase();

    return auditLogs.filter(event => {
      if (auditCategory !== 'all' && event.category !== auditCategory) {
        return false;
      }
      if (!query) return true;

      const searchable = [
        event.summary,
        event.action,
        event.deviceId,
        event.uid,
        event.studentId,
        event.studentName,
        event.actor,
        event.occurredAt,
        formatDate(String(event.occurredAt || '').slice(0, 10)),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [auditCategory, auditLogSearch, auditLogs]);

  const filteredRecords = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const recordsToSearch =
      analyticsPeriod === 'day' && showAllDates
        ? records
        : periodRecords;

    if (!keyword) return recordsToSearch;

    const cleanKeyword = keyword.replace(/\s/g, '');

    return recordsToSearch.filter(item => {
      const name = String(item.name || '').toLowerCase();
      const id = String(item.studentId || '').toLowerCase();
      const uid = String(item.uid || '')
        .replace(/\s/g, '')
        .toLowerCase();
      const attendanceDate = String(item.attendanceDate || '').toLowerCase();
      const formattedDate = formatDate(attendanceDate).toLowerCase();
      const course = String(
        `${item.courseCode || ''} ${item.courseName || ''} ${item.room || ''} ${item.semester || ''}`
      ).toLowerCase();

      return (
        name.includes(keyword) ||
        id.includes(keyword) ||
        uid.includes(cleanKeyword) ||
        course.includes(keyword) ||
        attendanceDate.includes(keyword) ||
        formattedDate.includes(keyword)
      );
    });
  }, [analyticsPeriod, periodRecords, records, search, showAllDates]);

  const exportReport = async () => {
    if (sessionCount === 0) {
      setActionError('ไม่มีข้อมูลเช็กชื่อในช่วงเวลาที่เลือกสำหรับส่งออกรายงาน');
      return;
    }

    const periodLabel = {
      day: `รายวัน ${formatDate(date)}`,
      week: `รายสัปดาห์ ${formatDate(periodRange.start)} - ${formatDate(periodRange.end)}`,
      month: `รายเดือน ${formatDate(periodRange.start)} - ${formatDate(periodRange.end)}`,
    }[analyticsPeriod];
    const reportRows = [
      ['รายงานวิเคราะห์การเข้าเรียน'], ['ช่วงเวลา', periodLabel],
      ['วันที่มีข้อมูลเช็กชื่อ', sessionDates.join(', ')], ['จำนวนนักศึกษา', students.length],
      ['จำนวนคาบที่มีข้อมูลเช็กชื่อ', sessionCount], ['จำนวนครั้งมาเรียน', totalPresent],
      ['จำนวนครั้งขาดเรียน', absentCount], ['อัตราการเข้าเรียนรวม (%)', overallAttendanceRate], [],
      ['รหัสนักศึกษา', 'ชื่อ', 'มาเรียน (คาบ)', 'ขาดเรียน (คาบ)', 'อัตราการเข้าเรียน (%)'],
      ...studentAttendance.map(student => [student.studentId, student.name, student.attendedCount, student.absentCount, student.attendanceRate]), [],
      ['รายการเช็กชื่อทั้งหมด', periodRecords.length],
      ['วันที่', 'เวลาเช็กชื่อ', 'รหัสนักศึกษา', 'ชื่อ', 'สถานะ', 'รหัสวิชา', 'รายวิชา', 'ห้องเรียน', 'ภาคเรียน', 'RFID UID', 'อุปกรณ์', 'อุณหภูมิ (°C)', 'ความชื้น (%)'],
      ...periodRecords.map(record => [record.attendanceDate || '', formatTime(record.receivedAt), record.studentId || '', record.name || '', getAttendanceStatusLabel(record.status), record.courseCode || '', record.courseName || '', record.room || '', record.semester || '', String(record.uid || '').replace(/\s/g, '').toUpperCase(), record.deviceId || '', record.temperature ?? '', record.humidity ?? '']),
    ];
    const csv = '\uFEFF' + reportRows.map(row => row.map(escapeCsvCell).join(',')).join('\r\n');
    const filename = 'attendance-report-' + periodRange.start + '-' + periodRange.end + '.csv';

    setExportingReport(true);
    setActionError('');
    setActionMessage('');

    try {
      if (Platform.OS === 'web') {
        const file = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = window.URL.createObjectURL(file);
        const link = window.document.createElement('a');
        link.href = url;
        link.download = filename;
        window.document.body.appendChild(link);
        link.click();
        window.document.body.removeChild(link);
        window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      } else {
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error('อุปกรณ์นี้ไม่รองรับการแชร์ไฟล์');
        }

        const file = new File(Paths.cache, `attendance-report-${Date.now()}.csv`);
        file.create();
        file.write(csv);
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: 'รายงานการเข้าเรียน',
          UTI: 'public.comma-separated-values-text',
        });
      }

      setActionMessage('ส่งออกรายงาน CSV พร้อมสรุปและรายการเช็กชื่อทั้งหมดสำหรับ Excel เรียบร้อยแล้ว');
    } catch (e) {
      setActionError(`ส่งออกรายงานไม่สำเร็จ: ${e.message}`);
    } finally {
      setExportingReport(false);
    }
  };

  const refresh = () => {
    void loadAttendance(date, showAllDates, true);
    void loadStudents();
    void loadDevices(true);
  };

  const selectToday = () => {
    setAnalyticsPeriod('day');
    setShowAllDates(false);
    setDate(getBangkokDate());
  };

  const selectAllDates = () => {
    setAnalyticsPeriod('day');
    setShowAllDates(true);
  };

  const selectAnalyticsPeriod = period => {
    setAnalyticsPeriod(period);
    setShowAllDates(period !== 'day');
  };

  // =====================================
  // RENDER
  // =====================================

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* HEADER */}
        <View style={[styles.header, isMobile && styles.headerMobile]}>
          <View style={styles.headerInner}>
            <View style={styles.brandRow}>
              <View style={styles.logo}>
                <Image
                  source={require('./assets/Smart Attendance Box Logo.png')}
                  style={styles.logoImage}
                  resizeMode="contain"
                  accessibilityLabel="SMART ATTENDANCE BOX"
                />
              </View>

              <View style={{ flex: 1 }}>
                {width >= 360 && (
                  <Text style={styles.brandTitle} numberOfLines={1}>
                    SMART ATTENDANCE BOX
                  </Text>
                )}
                <Text style={styles.brandSubtitle}>
                  ระบบจัดการการเข้าเรียน
                </Text>
              </View>

              <View
                style={[
                  styles.connection,
                  error
                    ? styles.connectionError
                    : lastUpdated
                      ? styles.connectionOnline
                      : null,
                ]}
              >
                <View
                  style={[
                    styles.connectionDot,
                    error
                      ? { backgroundColor: C.red }
                      : lastUpdated
                        ? { backgroundColor: C.green }
                        : null,
                  ]}
                />

                <Text style={styles.connectionText}>
                  {error
                    ? 'API ขัดข้อง'
                    : lastUpdated
                      ? isMobile
                        ? 'ออนไลน์'
                        : 'API เชื่อมต่อแล้ว'
                      : 'กำลังเชื่อมต่อ'}
                </Text>
              </View>
            </View>

          </View>
        </View>

        {/* MAIN */}
        <View style={[styles.main, isMobile && styles.mainMobile]}>
          <View style={styles.pageHeading}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pageTitle}>
                {APP_PAGES.find(page => page.path === activePage)?.title}
              </Text>
              <Text style={styles.subtitle}>
                {activePage === '/'
                  ? showAllDates
                    ? 'ข้อมูลประวัติทั้งหมด'
                    : `วันที่ ${formatDate(date)}`
                  : activePage === '/attendance'
                    ? showAllDates
                      ? 'ประวัติการเข้าเรียนทั้งหมด'
                      : `ข้อมูลวันที่ ${formatDate(date)}`
                    : activePage === '/management'
                      ? `${students.length} นักศึกษา · ${courses.length} รายวิชา · ${schedules.length} คาบ`
                      : activePage === '/devices'
                        ? 'สถานะอัปเดตทุก 15 วินาที'
                        : activePage === '/sensors'
                          ? `ข้อมูลย้อนหลัง ${sensorPeriodHours} ชั่วโมง`
                          : `${filteredAuditLogs.length} เหตุการณ์`}
              </Text>
            </View>

            {(activePage === '/' ||
              activePage === '/attendance' ||
              activePage === '/devices' ||
              activePage === '/management') && (
              <ActionButton
                title={refreshing ? 'กำลังโหลด...' : 'รีเฟรชข้อมูล'}
                onPress={() => {
                  refresh();
                  if (activePage === '/management') {
                    void loadManagementData();
                  }
                }}
                disabled={refreshing}
                active
              />
            )}
          </View>

          {!!actionMessage && (
            <View style={styles.successBox}>
              <Text style={styles.successText}>{actionMessage}</Text>
            </View>
          )}
          {!!actionError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>{actionError}</Text>
              <Pressable
                onPress={() => setActionError('')}
                style={styles.dismissButton}
              >
                <Text style={styles.dismissText}>ปิดข้อความ</Text>
              </Pressable>
            </View>
          )}

          {activePage === '/management' && (
          <>
            <View style={styles.panel}>
              <SectionTitle
                title={editingStudentId ? 'แก้ไขข้อมูลนักศึกษา' : 'เพิ่มนักศึกษา'}
                subtitle="กำหนดรหัส ชื่อ และ UID บัตรสำหรับผูกข้อมูลเช็คชื่อ"
                right={
                  <Text style={styles.resultCount}>
                    {students.length} คน
                  </Text>
                }
              />
              {!!managementError && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>{managementError}</Text>
                </View>
              )}
              {!!studentsError && (
                <View style={styles.warningBox}>
                  <Text style={styles.warningText}>
                    โหลดข้อมูลนักศึกษาจาก API ไม่สำเร็จ จึงไม่สามารถรับประกันการบันทึกหรือแก้ไขได้
                  </Text>
                </View>
              )}
              <TextInput
                value={studentForm.studentId}
                onChangeText={value =>
                  setStudentForm(current => ({ ...current, studentId: value }))
                }
                placeholder="รหัสนักศึกษา"
                placeholderTextColor="#8A95A4"
                style={styles.input}
                editable={!editingStudentId}
                autoCapitalize="none"
                accessibilityLabel="รหัสนักศึกษา"
              />
              {!!editingStudentId && (
                <Text style={styles.formHint}>
                  ไม่สามารถเปลี่ยนรหัสได้ เพราะประวัติการเข้าเรียนเดิมอ้างอิงรหัสนี้
                </Text>
              )}
              <TextInput
                value={studentForm.name}
                onChangeText={value =>
                  setStudentForm(current => ({ ...current, name: value }))
                }
                placeholder="ชื่อ-นามสกุล"
                placeholderTextColor="#8A95A4"
                style={styles.input}
                accessibilityLabel="ชื่อนักศึกษา"
              />
              <TextInput
                value={studentForm.uid}
                onChangeText={value =>
                  setStudentForm(current => ({
                    ...current,
                    uid: value.replace(/\s/g, '').toUpperCase(),
                  }))
                }
                placeholder="UID บัตร RFID (ไม่บังคับ)"
                placeholderTextColor="#8A95A4"
                style={styles.input}
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel="UID บัตร RFID"
              />
              <View style={styles.actions}>
                <ActionButton
                  title={managementSaving ? 'กำลังบันทึก...' : editingStudentId ? 'บันทึกการแก้ไข' : 'เพิ่มนักศึกษา'}
                  onPress={() => void saveStudent()}
                  disabled={managementSaving || studentsLoading || !!studentsError}
                  active
                />
                {!!editingStudentId && (
                  <ActionButton
                    title="ยกเลิก"
                    onPress={resetStudentForm}
                    disabled={managementSaving}
                  />
                )}
              </View>

              <Text style={styles.listHeading}>รายชื่อนักศึกษา</Text>
              {managementLoading || studentsLoading ? (
                <View style={styles.inlineLoading}>
                  <ActivityIndicator color={C.blue} />
                  <Text style={styles.messageText}>กำลังโหลดข้อมูล...</Text>
                </View>
              ) : students.length === 0 ? (
                <View style={styles.messageBox}>
                  <Text style={styles.messageText}>ยังไม่มีรายชื่อนักศึกษา</Text>
                </View>
              ) : (
                students.map(student => {
                  const studentId = String(student.studentId || student.id || '');
                  return (
                    <View key={student.id || studentId} style={styles.manageRow}>
                      <View style={styles.manageDetails}>
                        <Text style={styles.studentName}>
                          {student.name || 'ไม่ระบุชื่อ'}
                        </Text>
                        <Text style={styles.studentId}>
                          รหัส {studentId}
                          {student.uid || student.cardUid
                            ? ` · UID ${student.uid || student.cardUid}`
                            : ' · ยังไม่ผูกบัตร'}
                        </Text>
                      </View>
                      <View style={styles.manageActions}>
                        <ActionButton
                          title="แก้ไข"
                          onPress={() => {
                            setEditingStudentId(String(student.id || studentId));
                            setStudentForm({
                              studentId,
                              name: String(student.name || ''),
                              uid: String(student.uid || student.cardUid || ''),
                            });
                          }}
                          disabled={managementSaving}
                        />
                        <ActionButton
                          title="ลบ"
                          onPress={() => void deleteStudent(student)}
                          disabled={managementSaving || !!deletingId}
                          danger
                        />
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            <View style={styles.panel}>
              <SectionTitle
                title={editingCourseId ? 'แก้ไขรายวิชา' : 'รายวิชา ห้องเรียน และภาคเรียน'}
                subtitle="เพิ่มข้อมูลรายวิชาก่อนกำหนดวันและเวลาเรียน"
                right={
                  <Text style={styles.resultCount}>
                    {courses.length} วิชา
                  </Text>
                }
              />
              <TextInput
                value={courseForm.courseCode}
                onChangeText={value =>
                  setCourseForm(current => ({ ...current, courseCode: value }))
                }
                placeholder="รหัสวิชา เช่น CS101"
                placeholderTextColor="#8A95A4"
                style={styles.input}
                autoCapitalize="characters"
                accessibilityLabel="รหัสวิชา"
              />
              <TextInput
                value={courseForm.courseName}
                onChangeText={value =>
                  setCourseForm(current => ({ ...current, courseName: value }))
                }
                placeholder="ชื่อวิชา"
                placeholderTextColor="#8A95A4"
                style={styles.input}
                accessibilityLabel="ชื่อวิชา"
              />
              <View style={styles.formRow}>
                <TextInput
                  value={courseForm.room}
                  onChangeText={value =>
                    setCourseForm(current => ({ ...current, room: value }))
                  }
                  placeholder="ห้องเรียน"
                  placeholderTextColor="#8A95A4"
                  style={[styles.input, styles.formField]}
                  accessibilityLabel="ห้องเรียน"
                />
                <TextInput
                  value={courseForm.semester}
                  onChangeText={value =>
                    setCourseForm(current => ({ ...current, semester: value }))
                  }
                  placeholder="ภาคเรียน เช่น 1/2569"
                  placeholderTextColor="#8A95A4"
                  style={[styles.input, styles.formField]}
                  accessibilityLabel="ภาคเรียน"
                />
              </View>
              <View style={styles.actions}>
                <ActionButton
                  title={managementSaving ? 'กำลังบันทึก...' : editingCourseId ? 'บันทึกการแก้ไข' : 'เพิ่มรายวิชา'}
                  onPress={() => void saveCourse()}
                  disabled={managementSaving}
                  active
                />
                {!!editingCourseId && (
                  <ActionButton
                    title="ยกเลิก"
                    onPress={() => {
                      setEditingCourseId('');
                      setCourseForm({
                        courseCode: '',
                        courseName: '',
                        room: '',
                        semester: '',
                      });
                    }}
                    disabled={managementSaving}
                  />
                )}
              </View>

              {courses.length > 0 && (
                <>
                  <Text style={styles.listHeading}>รายวิชาที่ลงทะเบียน</Text>
                  {courses.map(course => (
                    <View key={course.id} style={styles.manageRow}>
                      <View style={styles.manageDetails}>
                        <Text style={styles.studentName}>
                          {course.courseCode} · {course.courseName}
                        </Text>
                        <Text style={styles.studentId}>
                          ห้อง {course.room} · ภาคเรียน {course.semester}
                        </Text>
                      </View>
                      <View style={styles.manageActions}>
                        <ActionButton
                          title="แก้ไข"
                          onPress={() => {
                            setEditingCourseId(course.id);
                            setCourseForm({
                              courseCode: course.courseCode || '',
                              courseName: course.courseName || '',
                              room: course.room || '',
                              semester: course.semester || '',
                            });
                          }}
                          disabled={managementSaving}
                        />
                        <ActionButton
                          title="ลบ"
                          onPress={() =>
                            void deleteManagedRecord(
                              'courses',
                              course.id,
                              `รายวิชา ${course.courseCode}`
                            )
                          }
                          disabled={managementSaving}
                          danger
                        />
                      </View>
                    </View>
                  ))}
                </>
              )}
            </View>

            <View style={styles.panel}>
              <SectionTitle
                title={editingScheduleId ? 'แก้ไขคาบเรียน' : 'ตารางเรียนประจำสัปดาห์'}
                subtitle="ช่วงเวลาเช็คชื่อของทุกคาบต้องไม่ทับซ้อนกัน"
                right={
                  <Text style={styles.resultCount}>
                    {schedules.length} คาบ
                  </Text>
                }
              />
              {courses.length === 0 ? (
                <View style={styles.messageBox}>
                  <Text style={styles.emptyTitle}>เพิ่มรายวิชาก่อนกำหนดตารางเรียน</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>รายวิชา</Text>
                  <View style={styles.actions}>
                    {courses.map(course => (
                      <ActionButton
                        key={course.id}
                        title={`${course.courseCode} · ${course.courseName}`}
                        onPress={() =>
                          setScheduleForm(current => ({
                            ...current,
                            courseId: course.id,
                          }))
                        }
                        active={scheduleForm.courseId === course.id}
                      />
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>วันเรียน</Text>
                  <View style={styles.actions}>
                    {WEEKDAY_OPTIONS.map(day => (
                      <ActionButton
                        key={day.value}
                        title={day.label}
                        onPress={() =>
                          setScheduleForm(current => ({
                            ...current,
                            weekday: day.value,
                          }))
                        }
                        active={scheduleForm.weekday === day.value}
                      />
                    ))}
                  </View>
                  <Text style={styles.fieldLabel}>
                    ช่วงเวลาที่ถือว่ามาตรงเวลา
                  </Text>
                  <View style={styles.actions}>
                    {LATE_AFTER_OPTIONS.map(minutes => (
                      <ActionButton
                        key={minutes}
                        title={`${minutes} นาที`}
                        onPress={() =>
                          setScheduleForm(current => ({
                            ...current,
                            lateAfterMinutes: minutes,
                          }))
                        }
                        active={scheduleForm.lateAfterMinutes === minutes}
                      />
                    ))}
                  </View>
                  <Text style={styles.formHint}>
                    หลังเปิดเช็คชื่อครบเวลานี้ ระบบจะบันทึกสถานะ “มาสาย”
                  </Text>
                  <View style={styles.formRow}>
                    <View style={styles.formField}>
                      <Text style={styles.fieldLabel}>เปิดเช็คชื่อ</Text>
                      <TextInput
                        value={scheduleForm.opensAt}
                        onChangeText={value =>
                          setScheduleForm(current => ({
                            ...current,
                            opensAt: value,
                          }))
                        }
                        placeholder="HH:MM"
                        placeholderTextColor="#8A95A4"
                        style={styles.input}
                        keyboardType="numbers-and-punctuation"
                        maxLength={5}
                        accessibilityLabel="เวลาเปิดเช็คชื่อ"
                      />
                    </View>
                    <View style={styles.formField}>
                      <Text style={styles.fieldLabel}>ปิดเช็คชื่อ</Text>
                      <TextInput
                        value={scheduleForm.closesAt}
                        onChangeText={value =>
                          setScheduleForm(current => ({
                            ...current,
                            closesAt: value,
                          }))
                        }
                        placeholder="HH:MM"
                        placeholderTextColor="#8A95A4"
                        style={styles.input}
                        keyboardType="numbers-and-punctuation"
                        maxLength={5}
                        accessibilityLabel="เวลาปิดเช็คชื่อ"
                      />
                    </View>
                  </View>
                  <Text style={styles.formHint}>
                    ใช้เวลาไทยแบบ 24 ชั่วโมง เช่น 08:30 ถึง 09:15
                  </Text>
                  <View style={styles.actions}>
                    <ActionButton
                      title={managementSaving ? 'กำลังบันทึก...' : editingScheduleId ? 'บันทึกการแก้ไข' : 'เพิ่มคาบเรียน'}
                      onPress={() => void saveSchedule()}
                      disabled={managementSaving || !scheduleForm.courseId}
                      active
                    />
                    {!!editingScheduleId && (
                      <ActionButton
                        title="ยกเลิก"
                        onPress={() => {
                          setEditingScheduleId('');
                          setScheduleForm({
                            courseId: '',
                            weekday: '1',
                            opensAt: '08:00',
                            closesAt: '09:00',
                            lateAfterMinutes: 10,
                          });
                        }}
                        disabled={managementSaving}
                      />
                    )}
                  </View>
                </>
              )}

              <Text style={styles.listHeading}>คาบเรียนทั้งหมด</Text>
              {schedules.length === 0 ? (
                <View style={styles.messageBox}>
                  <Text style={styles.messageText}>ยังไม่มีตารางเรียน</Text>
                </View>
              ) : (
                schedules.map(schedule => {
                  const day = WEEKDAY_OPTIONS.find(
                    item => item.value === String(schedule.weekday)
                  );
                  return (
                    <View key={schedule.id} style={styles.manageRow}>
                      <View style={styles.manageDetails}>
                        <Text style={styles.studentName}>
                          {day?.label || 'ไม่ระบุวัน'} · {schedule.opensAt}–{schedule.closesAt}
                        </Text>
                        <Text style={styles.studentId}>
                          {schedule.course?.courseCode || 'ไม่พบวิชา'} · {schedule.course?.courseName || ''}
                          {'\n'}ห้อง {schedule.course?.room || '-'} · ภาคเรียน {schedule.course?.semester || '-'}
                          {'\n'}ตรงเวลา {schedule.lateAfterMinutes ?? 10} นาที
                        </Text>
                      </View>
                      <View style={styles.manageActions}>
                        <ActionButton
                          title="แก้ไข"
                          onPress={() => {
                            setEditingScheduleId(schedule.id);
                            setScheduleForm({
                              courseId: schedule.courseId,
                              weekday: String(schedule.weekday),
                              opensAt: schedule.opensAt,
                              closesAt: schedule.closesAt,
                              lateAfterMinutes: Number(
                                schedule.lateAfterMinutes ?? 10
                              ),
                            });
                          }}
                          disabled={managementSaving}
                        />
                        <ActionButton
                          title="ลบ"
                          onPress={() =>
                            void deleteManagedRecord(
                              'schedules',
                              schedule.id,
                              'คาบเรียนนี้'
                            )
                          }
                          disabled={managementSaving}
                          danger
                        />
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </>
          )}

          {/* DEVICE MONITORING */}
          {activePage === '/devices' && (
          <View style={styles.panel}>
            <SectionTitle
              title="สถานะอุปกรณ์ ESP32"
              subtitle="ติดตามสถานะและบันทึกเหตุการณ์เชื่อมต่อแบบเรียลไทม์"
              right={
                <ActionButton
                  title={deviceRefreshing ? 'กำลังโหลด...' : 'รีเฟรชสถานะ'}
                  onPress={() => void loadDevices(true)}
                  disabled={deviceRefreshing}
                  active
                />
              }
            />

            <View style={styles.offlineAlertSettings}>
              <Text style={styles.fieldLabel}>
                แจ้งเตือนเมื่อ Offline เกิน (นาที)
              </Text>
              <TextInput
                value={offlineThresholdInput}
                onChangeText={setOfflineThresholdInput}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={4}
                style={[styles.input, styles.offlineThresholdInput]}
                accessibilityLabel="ระยะเวลาแจ้งเตือนเมื่ออุปกรณ์ออฟไลน์"
              />
            </View>
            {!validOfflineThreshold && (
              <Text style={styles.validationText}>
                กรุณาระบุระยะเวลา 1-1440 นาที
              </Text>
            )}
            {longOfflineDevices.map(device => (
              <View
                key={`offline-alert-${device.id || device.deviceId}`}
                style={styles.offlineAlert}
                accessibilityRole="alert"
              >
                <Text style={styles.offlineAlertTitle}>
                  แจ้งเตือน: {device.deviceId || device.id} ออฟไลน์เกิน{' '}
                  {offlineThresholdMinutes} นาที
                </Text>
                <Text style={styles.warningText}>
                  ติดต่อเซิร์ฟเวอร์ครั้งล่าสุด {formatTime(device.lastSeen)}
                </Text>
              </View>
            ))}

            {!!deviceError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>
                  โหลดสถานะอุปกรณ์ไม่สำเร็จ
                </Text>
                <Text style={styles.messageText}>
                  {deviceError}
                </Text>
              </View>
            )}

            {deviceLoading && devices.length === 0 ? (
              <View style={styles.messageBox}>
                <ActivityIndicator color={C.blue} />
                <Text style={styles.messageText}>
                  กำลังตรวจสอบสถานะ ESP32...
                </Text>
              </View>
            ) : devices.length === 0 ? (
              <View style={styles.messageBox}>
                <Text style={styles.emptyTitle}>
                  ยังไม่มีข้อมูลอุปกรณ์
                </Text>
                <Text style={styles.messageText}>
                  ตรวจสอบว่า ESP32 ส่ง Heartbeat และ Backend ทำงานอยู่
                </Text>
              </View>
            ) : (
              devices.map(device => (
                <View
                  key={device.id || device.deviceId}
                  style={styles.record}
                >
                  <View style={styles.recordTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.studentName}>
                        {device.deviceId || device.id}
                      </Text>
                      <Text style={styles.studentId}>
                        IP Address: {device.ip || '-'}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.status,
                        device.online
                          ? styles.statusPresent
                          : styles.deviceStatusOffline,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          device.online
                            ? styles.statusTextPresent
                            : styles.deviceStatusOfflineText,
                        ]}
                      >
                        {device.online ? 'ONLINE' : 'OFFLINE'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.recordDetails}>
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>
                        Wi-Fi RSSI
                      </Text>
                      <Text style={styles.detailValue}>
                        {device.rssi !== null &&
                        device.rssi !== undefined &&
                        Number.isFinite(Number(device.rssi))
                          ? `${device.rssi} dBm`
                          : '-'}
                      </Text>
                    </View>

                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>
                        ติดต่อครั้งล่าสุด
                      </Text>
                      <Text style={styles.detailValue}>
                        {formatTime(device.lastSeen)}
                      </Text>
                    </View>
                    {!device.online && (
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>
                          ออฟไลน์ตั้งแต่
                        </Text>
                        <Text style={styles.detailValue}>
                          {formatTime(device.offlineSince)}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              ))
            )}

            <View style={styles.deviceEvents}>
              <Text style={styles.chartTitle}>ประวัติการเปลี่ยนสถานะ</Text>
              {!!deviceEventError && (
                <Text style={styles.validationText}>{deviceEventError}</Text>
              )}
              {deviceEvents.length === 0 && !deviceEventError ? (
                <Text style={styles.messageText}>
                  ยังไม่มีเหตุการณ์เปลี่ยนสถานะหลังเริ่มบันทึก
                </Text>
              ) : (
                deviceEvents.map(event => (
                  <View key={event.id} style={styles.deviceEventRow}>
                    <View
                      style={[
                        styles.eventDot,
                        event.status === 'online'
                          ? styles.eventDotOnline
                          : styles.eventDotOffline,
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.deviceEventTitle}>
                        {event.deviceId}{' '}
                        {event.status === 'online'
                          ? 'กลับมาออนไลน์'
                          : 'ออฟไลน์'}
                      </Text>
                      <Text style={styles.deviceEventTime}>
                        {formatTime(event.occurredAt)} ·{' '}
                        {formatDate(String(event.occurredAt || '').slice(0, 10))}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            <Text style={styles.note}>
              อัปเดตสถานะล่าสุด: {deviceLastUpdated || '-'}
              {'\n'}ดึงข้อมูลใหม่ทุก 15 วินาที
              {'\n'}Backend จะถือว่า Offline เมื่อขาด Heartbeat เกิน 60 วินาที; แจ้งเตือนในหน้านี้เมื่อครบเวลาที่ตั้งไว้
            </Text>
          </View>
          )}

          {/* AUDIT LOG */}
          {activePage === '/audit' && (
          <View style={styles.panel}>
            <SectionTitle
              title="บันทึกเหตุการณ์ (Audit Log)"
              subtitle="ติดตามการสแกน อุปกรณ์ และการจัดการข้อมูลย้อนหลัง"
              right={
                <ActionButton
                  title="รีเฟรชบันทึก"
                  onPress={() => void loadAuditLogs()}
                  active
                />
              }
            />

            <TextInput
              value={auditLogSearch}
              onChangeText={setAuditLogSearch}
              placeholder="ค้นหาชื่อ รหัสนักศึกษา UID อุปกรณ์ หรือวันที่"
              placeholderTextColor="#8A95A4"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.actions}>
              {AUDIT_CATEGORIES.map(category => (
                <ActionButton
                  key={category.value}
                  title={category.label}
                  onPress={() => setAuditCategory(category.value)}
                  active={auditCategory === category.value}
                />
              ))}
            </View>

            {!!auditLogError && (
              <View style={styles.errorBox}>
                <Text style={styles.messageText}>{auditLogError}</Text>
              </View>
            )}
            {!auditLogError && filteredAuditLogs.length === 0 ? (
              <View style={styles.messageBox}>
                <Text style={styles.emptyTitle}>
                  {auditLogs.length
                    ? 'ไม่พบเหตุการณ์ที่ตรงกับตัวกรอง'
                    : 'ยังไม่มีประวัติเหตุการณ์'}
                </Text>
                <Text style={styles.messageText}>
                  {auditLogs.length
                    ? 'ลองเปลี่ยนหมวดหมู่หรือคำค้นหา'
                    : 'เหตุการณ์ใหม่จะถูกบันทึกเมื่อมีการสแกนหรือจัดการข้อมูล'}
                </Text>
              </View>
            ) : (
              filteredAuditLogs.map(event => (
                <View key={event.id} style={styles.auditRow}>
                  <View
                    style={[
                      styles.eventDot,
                      event.action === 'scan_success' ||
                      event.action === 'device_online'
                        ? styles.eventDotOnline
                        : styles.eventDotOffline,
                    ]}
                  />
                  <View style={styles.auditDetails}>
                    <Text style={styles.auditTitle}>
                      {event.summary ||
                        AUDIT_ACTION_LABELS[event.action] ||
                        event.action}
                    </Text>
                    <Text style={styles.auditMeta}>
                      {formatDate(String(event.occurredAt || '').slice(0, 10))}{' '}
                      {formatTime(event.occurredAt)}
                      {event.actor ? ` · ผู้ดำเนินการ: ${event.actor}` : ''}
                    </Text>
                    {!!(
                      event.studentName ||
                      event.studentId ||
                      event.uid ||
                      event.deviceId ||
                      event.courseName ||
                      event.courseCode
                    ) && (
                      <Text style={styles.auditMeta}>
                        {[
                          event.studentName,
                          event.studentId && `รหัส ${event.studentId}`,
                          event.uid && `UID ${event.uid}`,
                          event.deviceId && `อุปกรณ์ ${event.deviceId}`,
                          event.courseCode && `วิชา ${event.courseCode}`,
                          event.courseName && !event.courseCode && event.courseName,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    )}
                  </View>
                </View>
              ))
            )}
            <Text style={styles.note}>
              โหลดเหตุการณ์ล่าสุดสูงสุด 100 รายการ · อัปเดตทุก 30 วินาที
            </Text>
          </View>
          )}

          {/* ACTION MESSAGE */}

          {/* DHT11 SENSOR HISTORY */}
          {activePage === '/sensors' && (
          <View style={styles.panel}>
            <SectionTitle
              title="ติดตามอุณหภูมิและความชื้น"
              subtitle="ข้อมูลล่าสุดและกราฟย้อนหลังจาก DHT11"
              right={
                <ActionButton
                  title="รีเฟรชเซนเซอร์"
                  onPress={() => void loadSensorHistory()}
                  active
                />
              }
            />

            <Text style={styles.fieldLabel}>ช่วงเวลาย้อนหลัง</Text>
            <View style={styles.actions}>
              {SENSOR_HISTORY_PERIODS.map(period => (
                <ActionButton
                  key={period.hours}
                  title={period.label}
                  onPress={() => {
                    if (period.hours !== sensorPeriodHours) {
                      setSensorHistory([]);
                      setSensorPeriodHours(period.hours);
                    }
                  }}
                  active={sensorPeriodHours === period.hours}
                />
              ))}
            </View>

            <Text style={styles.sensorChartTitle}>เกณฑ์แจ้งเตือนสูงสุด</Text>
            <View style={styles.sensorThresholdRow}>
              <View style={styles.sensorThresholdCard}>
                <Text style={styles.detailLabel}>อุณหภูมิ (°C)</Text>
                <TextInput
                  value={temperatureThreshold}
                  onChangeText={setTemperatureThreshold}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  style={styles.sensorThresholdInput}
                  accessibilityLabel="เกณฑ์แจ้งเตือนอุณหภูมิสูงสุด"
                />
                {!validTemperatureThreshold && (
                  <Text style={styles.validationText}>
                    ใส่ค่าระหว่าง 20-50 °C
                  </Text>
                )}
              </View>
              <View style={styles.sensorThresholdCard}>
                <Text style={styles.detailLabel}>ความชื้น (%)</Text>
                <TextInput
                  value={humidityThreshold}
                  onChangeText={setHumidityThreshold}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  style={styles.sensorThresholdInput}
                  accessibilityLabel="เกณฑ์แจ้งเตือนความชื้นสูงสุด"
                />
                {!validHumidityThreshold && (
                  <Text style={styles.validationText}>
                    ใส่ค่าระหว่าง 0-100 %
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.actions}>
              <ActionButton
                title={temperatureThresholdSaving ? 'กำลังบันทึก...' : 'บันทึกเกณฑ์อุณหภูมิ'}
                onPress={saveTemperatureAlertSettings}
                active
                disabled={temperatureThresholdSaving || !validTemperatureThreshold}
              />
              <ActionButton
                title={`เสียงแจ้งเตือน: ${sensorSoundEnabled ? 'เปิด' : 'ปิด'}`}
                onPress={() => setSensorSoundEnabled(value => !value)}
                active={sensorSoundEnabled}
              />
              <ActionButton
                title="ทดสอบเสียง"
                onPress={playSensorAlertSound}
              />
            </View>
            {!!temperatureThresholdStatus && (
              <View style={temperatureThresholdStatus.includes('ไม่สำเร็จ') ? styles.warningBox : styles.successBox}>
                <Text style={temperatureThresholdStatus.includes('ไม่สำเร็จ') ? styles.warningText : styles.successText}>
                  {temperatureThresholdStatus}
                </Text>
              </View>
            )}
            {!!sensorSoundError && (
              <View style={styles.errorBox}>
                <Text style={styles.messageText}>{sensorSoundError}</Text>
              </View>
            )}

            {!!sensorError && (
              <View style={styles.errorBox}>
                <Text style={styles.messageText}>{sensorError}</Text>
              </View>
            )}
            {sensorLoading && sensorHistory.length > 0 && (
              <View style={styles.inlineLoading}>
                <ActivityIndicator color={C.blue} />
                <Text style={styles.messageText}>กำลังอัปเดตข้อมูล DHT11...</Text>
              </View>
            )}

            {sensorLoading && sensorHistory.length === 0 ? (
              <View style={styles.messageBox}>
                <ActivityIndicator color={C.blue} />
                <Text style={styles.messageText}>
                  กำลังโหลดข้อมูล DHT11...
                </Text>
              </View>
            ) : sensorHistory.length === 0 ? (
              <View style={styles.messageBox}>
                <Text style={styles.emptyTitle}>ยังไม่มีข้อมูลเซนเซอร์</Text>
                <Text style={styles.messageText}>
                  ไม่พบข้อมูล DHT11 ในช่วง {sensorPeriodHours} ชั่วโมงที่ผ่านมา
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.sensorSummaryRow}>
                  <View style={styles.sensorSummaryCard}>
                    <Text style={styles.detailLabel}>อุณหภูมิล่าสุด</Text>
                    <Text
                      style={[
                        styles.sensorTemperature,
                        latestTemperatureAlert && styles.sensorAlertValue,
                      ]}
                    >
                      {Number(latestSensor.temperature).toFixed(1)} °C
                    </Text>
                    <Text style={styles.sensorThresholdNote}>
                      เกณฑ์ไม่เกิน {temperatureLimit} °C
                    </Text>
                  </View>
                  <View style={styles.sensorSummaryCard}>
                    <Text style={styles.detailLabel}>ความชื้นล่าสุด</Text>
                    <Text
                      style={[
                        styles.sensorHumidity,
                        latestHumidityAlert && styles.sensorAlertValue,
                      ]}
                    >
                      {Number(latestSensor.humidity).toFixed(1)} %
                    </Text>
                    <Text style={styles.sensorThresholdNote}>
                      เกณฑ์ไม่เกิน {humidityLimit} %
                    </Text>
                  </View>
                </View>

                {(latestTemperatureAlert || latestHumidityAlert) && (
                  <View style={styles.sensorWarning}>
                    <Text style={styles.sensorWarningTitle}>
                      ค่าล่าสุดเกินเกณฑ์ที่กำหนด
                    </Text>
                    <Text style={styles.warningText}>
                      {[
                        latestTemperatureAlert &&
                          `อุณหภูมิ ${Number(latestSensor.temperature).toFixed(1)} °C`,
                        latestHumidityAlert &&
                          `ความชื้น ${Number(latestSensor.humidity).toFixed(1)} %`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                )}

                <Text style={styles.sensorChartTitle}>อุณหภูมิ (°C)</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator
                  contentContainerStyle={styles.sensorChart}
                >
                  {sensorChartData.map((item, index) => {
                    const value = Number(item.temperature);
                    const values = sensorChartData.map(row =>
                      Number(row.temperature)
                    );
                    const min = Math.min(...values);
                    const max = Math.max(...values);
                    const height =
                      max === min
                        ? 45
                        : 18 + ((value - min) / (max - min)) * 65;
                    const abnormal =
                      validTemperatureThreshold && value > temperatureLimit;

                    return (
                      <View
                        key={item.id || `temp-${index}`}
                        style={styles.sensorBarColumn}
                      >
                        <Text style={styles.sensorBarValue}>
                          {value.toFixed(1)}
                        </Text>
                        <View
                          style={[
                            styles.sensorBar,
                            {
                              height,
                              backgroundColor: abnormal ? C.red : C.blue,
                            },
                          ]}
                        />
                        <Text style={styles.sensorBarTime}>
                          {formatTime(item.recordedAt || item.timestamp)}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>

                <Text style={styles.sensorChartTitle}>ความชื้น (%)</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator
                  contentContainerStyle={styles.sensorChart}
                >
                  {sensorChartData.map((item, index) => {
                    const value = Number(item.humidity);
                    const abnormal =
                      validHumidityThreshold && value > humidityLimit;

                    return (
                      <View
                        key={item.id || `humidity-${index}`}
                        style={styles.sensorBarColumn}
                      >
                        <Text style={styles.sensorBarValue}>
                          {value.toFixed(0)}%
                        </Text>
                        <View
                          style={[
                            styles.sensorBar,
                            {
                              height: Math.max(8, value * 0.83),
                              backgroundColor: abnormal ? C.red : C.green,
                            },
                          ]}
                        />
                        <Text style={styles.sensorBarTime}>
                          {formatTime(item.recordedAt || item.timestamp)}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              </>
            )}

            <View style={styles.abnormalHistory}>
              <Text style={styles.sensorChartTitle}>
                ประวัติค่าเกินเกณฑ์ ({abnormalSensorHistory.length})
              </Text>
              {abnormalSensorHistory.length === 0 ? (
                <Text style={styles.messageText}>
                  ไม่พบค่าที่เกินเกณฑ์ในช่วงเวลาที่เลือก
                </Text>
              ) : (
                abnormalSensorHistory.slice(0, 20).map((item, index) => {
                  const exceeded = [];
                  if (
                    validTemperatureThreshold &&
                    Number(item.temperature) > temperatureLimit
                  ) {
                    exceeded.push(
                      `อุณหภูมิ ${Number(item.temperature).toFixed(1)} °C`
                    );
                  }
                  if (
                    validHumidityThreshold &&
                    Number(item.humidity) > humidityLimit
                  ) {
                    exceeded.push(
                      `ความชื้น ${Number(item.humidity).toFixed(1)} %`
                    );
                  }

                  return (
                    <View
                      key={item.id || `abnormal-${index}`}
                      style={styles.abnormalRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.abnormalValue}>
                          {exceeded.join(' · ')}
                        </Text>
                        <Text style={styles.deviceEventTime}>
                          {formatDate(
                            String(
                              item.recordedAt ||
                                new Date(Number(item.timestamp)).toISOString()
                            ).slice(0, 10)
                          )}{' '}
                          {formatTime(item.recordedAt || item.timestamp)}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            <Text style={styles.note}>
              อัปเดตล่าสุด: {sensorLastUpdated || '-'}
              {'\n'}รีเฟรชข้อมูลทุก 30 วินาที · กราฟแสดงตัวอย่างไม่เกิน 30 จุด
              {'\n'}ค้นหาจากข้อมูลย้อนหลังสูงสุด 3,000 จุด; แสดงค่าผิดปกติ 20 รายการล่าสุด
              {Platform.OS === 'web' &&
                '\nเว็บเบราว์เซอร์อาจต้องกด “ทดสอบเสียง” ก่อนจึงจะอนุญาตเสียงเตือนอัตโนมัติ'}
            </Text>
          </View>
          )}

          {/* STATS */}
          {activePage === '/' && (
          <>
          <View style={styles.dashboardHero}>
            <View style={styles.dashboardHeroCopy}>
              <Text style={styles.dashboardEyebrow}>SMART ATTENDANCE</Text>
              <Text style={styles.dashboardTitle}>ภาพรวมวันนี้</Text>
              <Text style={styles.dashboardDate}>{formatDate(date)} · อัปเดต {lastUpdated || 'กำลังโหลด'}</Text>
            </View>
            <View style={[styles.dashboardApiBadge, error ? styles.dashboardApiBadgeError : null]}>
              <View style={[styles.dashboardApiDot, error ? styles.dashboardApiDotError : null]} />
              <Text style={[styles.dashboardApiText, error ? styles.dashboardApiTextError : null]}>
                {error ? 'API ขัดข้อง' : lastUpdated ? 'เชื่อมต่อแล้ว' : 'กำลังเชื่อมต่อ'}
              </Text>
            </View>
          </View>

          <View style={styles.dashboardStats}>
            <View style={[styles.dashboardStatCard, styles.dashboardStatBlue]}>
              <Text style={styles.dashboardStatLabel}>เช็คชื่อวันนี้</Text>
              <Text style={styles.dashboardStatValue}>{records.length}</Text>
              <Text style={styles.dashboardStatHint}>รายการทั้งหมด</Text>
            </View>
            <View style={[styles.dashboardStatCard, styles.dashboardStatGreen]}>
              <Text style={styles.dashboardStatLabel}>มาเรียน</Text>
              <Text style={styles.dashboardStatValue}>{records.filter(item => isAttendedStatus(item.status)).length}</Text>
              <Text style={styles.dashboardStatHint}>รวมมาสาย</Text>
            </View>
            <View style={[styles.dashboardStatCard, styles.dashboardStatPurple]}>
              <Text style={styles.dashboardStatLabel}>นักศึกษา</Text>
              <Text style={styles.dashboardStatValue}>{students.length}</Text>
              <Text style={styles.dashboardStatHint}>รายชื่อในระบบ</Text>
            </View>
            <View style={[styles.dashboardStatCard, styles.dashboardStatOrange]}>
              <Text style={styles.dashboardStatLabel}>อุปกรณ์ออนไลน์</Text>
              <Text style={styles.dashboardStatValue}>{devices.filter(device => device.online).length}<Text style={styles.dashboardStatTotal}> / {devices.length}</Text></Text>
              <Text style={styles.dashboardStatHint}>เครื่องเช็คชื่อ</Text>
            </View>
          </View>

          <View style={styles.panel}>
            <SectionTitle
              title="เช็คชื่อล่าสุด"
              subtitle={`ข้อมูลจาก API · ${records.length} รายการวันนี้`}
              right={<Link href="/attendance" asChild><Pressable style={styles.dashboardSeeAll}><Text style={styles.dashboardSeeAllText}>ดูทั้งหมด ›</Text></Pressable></Link>}
            />
            {loading && records.length === 0 ? (
              <View style={styles.inlineLoading}><ActivityIndicator color={C.blue} /><Text style={styles.messageText}>กำลังโหลดข้อมูล...</Text></View>
            ) : records.length === 0 ? (
              <View style={styles.messageBox}><Text style={styles.messageText}>{error ? 'โหลดข้อมูลไม่ได้ กรุณาตรวจสอบการเชื่อมต่อ API' : 'ยังไม่มีรายการเช็คชื่อวันนี้'}</Text></View>
            ) : records.slice(0, 5).map((item, index) => (
              <View key={getRecordKey(item, index)} style={styles.dashboardRecentRow}>
                <View style={styles.dashboardAvatar}><Text style={styles.dashboardAvatarText}>{String(item.name || '?').trim().slice(0, 1).toUpperCase()}</Text></View>
                <View style={styles.dashboardRecentDetails}>
                  <Text style={styles.dashboardRecentName} numberOfLines={1}>{item.name || 'ไม่ระบุชื่อ'}</Text>
                  <Text style={styles.dashboardRecentMeta} numberOfLines={1}>{item.studentId || 'ไม่มีรหัสนักศึกษา'}{item.courseCode ? ` · ${item.courseCode}` : ''}</Text>
                </View>
                <View style={styles.dashboardRecentRight}>
                  <Text style={[styles.dashboardStatus, item.status === 'late' ? styles.dashboardStatusLate : styles.dashboardStatusPresent]}>{item.status === 'late' ? 'มาสาย' : isAttendedStatus(item.status) ? 'มาเรียน' : item.status || 'ไม่ระบุ'}</Text>
                  <Text style={styles.dashboardRecentTime}>{formatTime(item.receivedAt || item.timestamp)}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* ATTENDANCE ANALYTICS */}
          <View style={styles.panel}>
            <SectionTitle
              title="วิเคราะห์สถิติการเข้าเรียน"
              subtitle={`${formatDate(periodRange.start)} - ${formatDate(periodRange.end)} · ${sessionCount} คาบที่มีข้อมูล`}
              right={
                <ActionButton
                  title={exportingReport ? 'กำลังส่งออก...' : 'ส่งออก Excel (CSV)'}
                  onPress={() => void exportReport()}
                  disabled={exportingReport || loading}
                  active
                />
              }
            />

            <View style={styles.actions}>
              <ActionButton
                title="รายวัน"
                onPress={() => selectAnalyticsPeriod('day')}
                active={analyticsPeriod === 'day'}
              />
              <ActionButton
                title="รายสัปดาห์"
                onPress={() => selectAnalyticsPeriod('week')}
                active={analyticsPeriod === 'week'}
              />
              <ActionButton
                title="รายเดือน"
                onPress={() => selectAnalyticsPeriod('month')}
                active={analyticsPeriod === 'month'}
              />
            </View>

            <View style={[styles.stats, styles.analyticsStats]}>
              <View style={styles.analyticsStat}>
                <Text style={styles.detailLabel}>มาเรียนรวม</Text>
                <Text style={[styles.analyticsValue, { color: C.green }]}>
                  {totalPresent}
                </Text>
                <Text style={styles.statNote}>ครั้งในช่วงที่เลือก</Text>
              </View>
              <View style={styles.analyticsStat}>
                <Text style={styles.detailLabel}>ขาดเรียนรวม</Text>
                <Text style={[styles.analyticsValue, { color: C.red }]}>
                  {absentCount}
                </Text>
                <Text style={styles.statNote}>ครั้งจากวันที่มีข้อมูล</Text>
              </View>
              <View style={styles.analyticsStat}>
                <Text style={styles.detailLabel}>อัตราเข้าเรียนรวม</Text>
                <Text style={[styles.analyticsValue, { color: C.blue }]}>
                  {overallAttendanceRate}%
                </Text>
                <Text style={styles.statNote}>มาเรียน ÷ ครั้งที่คาดหมาย</Text>
              </View>
            </View>

            <Text style={styles.chartTitle}>สรุปการเข้าเรียนแยกตามรายวิชา</Text>
            {courseAttendance.length === 0 ? (
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>ยังไม่มีรายวิชาในระบบ</Text>
              </View>
            ) : (
              <>
                {courseAttendance.map(course => (
                  <View key={course.key} style={styles.courseAnalyticsRow}>
                    <View style={styles.courseAnalyticsHeader}>
                      <View style={styles.courseAnalyticsDetails}>
                        <Text style={styles.courseAnalyticsName} numberOfLines={1}>
                          {course.courseCode
                            ? `${course.courseCode} · ${course.courseName}`
                            : course.courseName}
                        </Text>
                        <Text style={styles.courseAnalyticsMeta}>
                          {course.sessionCount} คาบที่มีข้อมูล
                        </Text>
                      </View>
                      <Text style={styles.courseAnalyticsRate}>
                        {course.attendanceRate === null
                          ? '—'
                          : `${course.attendanceRate}%`}
                      </Text>
                    </View>
                    <View style={styles.attendanceBarTrack}>
                      <View
                        style={[
                          styles.attendanceBar,
                          {
                            width: `${course.attendanceRate || 0}%`,
                            backgroundColor:
                              course.attendanceRate !== null &&
                              course.attendanceRate >= 75
                                ? C.green
                                : C.orange,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.courseAnalyticsCounts}>
                      {course.sessionCount
                        ? `มา ${course.attendedCount} ครั้ง · ขาด ${course.absentStudentCount} คน (${course.absentCount} ครั้ง)`
                        : 'ยังไม่มีข้อมูลการเข้าเรียน'}
                    </Text>
                  </View>
                ))}
                <Text style={styles.note}>
                  อัตรารายวิชาคำนวณจากจำนวนนักศึกษา × คาบที่พบประวัติเช็คชื่อในช่วงเวลาที่เลือก
                </Text>
              </>
            )}

            <Text style={styles.chartTitle}>
              อัตราการเข้าเรียนแยกตามนักศึกษา
            </Text>

            {sessionCount === 0 ? (
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>
                  ไม่มีข้อมูลเช็คชื่อในช่วงเวลานี้ จึงยังคำนวณอัตราการเข้าเรียนไม่ได้
                </Text>
              </View>
            ) : studentAttendance.length === 0 ? (
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>
                  ไม่มีรายชื่อนักศึกษาสำหรับคำนวณสถิติ
                </Text>
              </View>
            ) : (
              studentAttendance.map(student => (
                <View
                  key={student.studentId}
                  style={styles.attendanceChartRow}
                >
                  <View style={styles.attendanceChartStudent}>
                    <Text style={styles.chartStudentName} numberOfLines={1}>
                      {student.name}
                    </Text>
                    <Text style={styles.chartStudentId}>
                      {student.studentId}
                    </Text>
                  </View>
                  <View style={styles.attendanceBarTrack}>
                    <View
                      style={[
                        styles.attendanceBar,
                        {
                          width: `${student.attendanceRate}%`,
                          backgroundColor:
                            student.attendanceRate >= 75
                              ? C.green
                              : C.orange,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.attendanceChartValue}>
                    {student.attendanceRate}%
                  </Text>
                  <Text style={styles.attendanceChartCount}>
                    {student.attendedCount}/{sessionCount} คาบ
                  </Text>
                </View>
              ))
            )}

            <Text style={styles.note}>
              นับวันเรียนจากวันที่มีรายการเช็คชื่อในระบบเท่านั้น เพราะยังไม่มีตารางวันสอน
              {'\n'}CSV มีข้อมูลสรุปรายคนและรายการเช็คชื่อทั้งหมด เปิดด้วย Microsoft Excel ได้
            </Text>
          </View>
          </>
          )}

          {/* FILTERS */}
          {activePage === '/attendance' && (
          <>
          <View style={styles.panel}>
            <SectionTitle
              title="ค้นหาและกรองข้อมูล"
              subtitle="ค้นหาด้วยชื่อ รหัสนักศึกษา UID บัตร รายวิชา ห้องเรียน หรือวันที่"
            />

            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="ชื่อ รหัส UID วิชา ห้อง หรือวันที่..."
              placeholderTextColor="#8A95A4"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.fieldLabel}>วันที่เช็คชื่อ</Text>

            {Platform.OS === 'web' ? (
              <input
                type="date"
                value={date}
                onChange={event => {
                  setDate(event.target.value);
                  setShowAllDates(analyticsPeriod !== 'day');
                }}
                aria-label="วันที่เช็คชื่อ"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  height: 44,
                  padding: '0 12px',
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  background: '#FFFFFF',
                  color: C.text,
                  fontSize: 14,
                  marginBottom: 12,
                }}
              />
            ) : (
              <Text style={styles.dateText}>
                {formatDate(date)}
              </Text>
            )}

            <View style={styles.actions}>
              <ActionButton
                title="วันนี้"
                onPress={selectToday}
                active={
                  !showAllDates && date === getBangkokDate()
                }
              />

              <ActionButton
                title="ประวัติทั้งหมด"
                onPress={selectAllDates}
                active={showAllDates}
              />
            </View>

            <View style={styles.updateInfo}>
              <Text style={styles.updateText}>
                {error
                  ? error
                  : lastUpdated
                    ? `อัปเดตล่าสุด ${lastUpdated}`
                    : 'กำลังโหลดข้อมูลจากเซิร์ฟเวอร์'}
              </Text>

              <Text style={styles.autoRefresh}>
                อัปเดตทุก 15 วินาที
              </Text>
            </View>
          </View>

          {/* ATTENDANCE HISTORY */}
          <View style={styles.panel}>
            <SectionTitle
              title="ประวัติการเข้าเรียน"
              subtitle="ลบเฉพาะประวัติรายวันเพื่อให้แตะบัตรใหม่ได้"
              right={
                <Text style={styles.resultCount}>
                  {filteredRecords.length} รายการ
                </Text>
              }
            />

            {loading && records.length === 0 ? (
              <View style={styles.messageBox}>
                <ActivityIndicator color={C.blue} />
                <Text style={styles.messageText}>
                  กำลังโหลดข้อมูล...
                </Text>
              </View>
            ) : error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>
                  ไม่สามารถโหลดข้อมูลได้
                </Text>
                <Text style={styles.messageText}>
                  ตรวจสอบว่าเปิด API อยู่ และตั้งค่า API_BASE ถูกต้อง
                </Text>
                <ActionButton
                  title="ลองอีกครั้ง"
                  onPress={refresh}
                  active
                />
              </View>
            ) : filteredRecords.length === 0 ? (
              <View style={styles.messageBox}>
                <Text style={styles.emptyTitle}>
                  ไม่พบประวัติการเช็คชื่อ
                </Text>
                <Text style={styles.messageText}>
                  ลองเปลี่ยนวันที่หรือคำค้นหา
                </Text>
              </View>
            ) : (
              filteredRecords.map((item, index) => {
                const isPresent = item.status === 'present';
                const isLate = item.status === 'late';
                const recordDeleteKey =
                  `attendance-${item.studentId}-${item.attendanceDate}`;

                return (
                  <View
                    key={getRecordKey(item, index)}
                    style={styles.record}
                  >
                    <View style={styles.recordTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.studentName}>
                          {item.name || 'ไม่ระบุชื่อ'}
                        </Text>
                        <Text style={styles.studentId}>
                          รหัสนักศึกษา: {item.studentId || '-'}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.status,
                          isPresent
                            ? styles.statusPresent
                            : isLate
                              ? styles.statusLate
                              : styles.statusOther,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusText,
                            isPresent
                              ? styles.statusTextPresent
                              : isLate
                                ? styles.statusTextLate
                                : styles.statusTextOther,
                          ]}
                        >
                          {getAttendanceStatusLabel(item.status)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.recordDetails}>
                      {!!item.courseName && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>รายวิชา</Text>
                          <Text style={styles.detailValue}>
                            {item.courseCode
                              ? `${item.courseCode} · ${item.courseName}`
                              : item.courseName}
                          </Text>
                        </View>
                      )}
                      {!!item.room && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>ห้องเรียน</Text>
                          <Text style={styles.detailValue}>{item.room}</Text>
                        </View>
                      )}
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>วันที่</Text>
                        <Text style={styles.detailValue}>
                          {formatDate(item.attendanceDate)}
                        </Text>
                      </View>

                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>เวลา</Text>
                        <Text style={styles.detailValue}>
                          {formatTime(item.receivedAt)}
                        </Text>
                      </View>

                      <View style={styles.uidItem}>
                        <Text style={styles.detailLabel}>
                          RFID UID
                        </Text>
                        <Text style={styles.detailValue}>
                          {String(item.uid || '-')
                            .replace(/\s/g, '')
                            .toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.recordActions}>
                      <Pressable
                        disabled={!!deletingId}
                        onPress={() => deleteAttendance(item)}
                        style={({ pressed }) => [
                          styles.deleteButton,
                          pressed && styles.buttonPressed,
                          !!deletingId && styles.buttonDisabled,
                        ]}
                      >
                        <Text style={styles.deleteButtonText}>
                          {deletingId === recordDeleteKey
                            ? 'กำลังลบ...'
                            : 'ลบประวัติเช็คชื่อ'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* VOICE */}
          {Platform.OS === 'web' && (
            <View style={styles.voicePanel}>
              <Text style={styles.voiceTitle}>
                ระบบเสียงแจ้งเตือน
              </Text>

              <Text style={styles.voiceText}>
                เมื่อพบรายการเช็คชื่อใหม่ของวันนี้ เว็บจะอ่านชื่อ
                และพูดว่า “เช็คชื่อแล้ว” โดยอัตโนมัติ
              </Text>

              <ActionButton
                title="ทดสอบเสียง"
                onPress={() =>
                  speakAttendance('ทดสอบระบบ เช็คชื่อแล้ว')
                }
              />
            </View>
          )}
          </>
          )}

          {/* FOOTER */}
          <View style={styles.footer}>
            <Text style={styles.footerTitle}>
              SMART ATTENDANCE BOX
            </Text>
            <Text style={styles.footerText}>
              ESP32 · RFID RC522 · Node.js · Firebase
            </Text>
            <Text style={styles.footerText}>
              ระบบจัดการการเข้าเรียนอัจฉริยะ
            </Text>
          </View>
        </View>
      </ScrollView>
      <View style={styles.tabBar}>
        {APP_PAGES.map(page => {
          const isActive = activePage === page.path;

          return (
            <Link
              key={page.path}
              href={page.path}
              asChild
            >
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                style={({ pressed }) => [
                  styles.tabItem,
                  isActive && styles.tabItemActive,
                  pressed && styles.tabItemPressed,
                ]}
              >
                <View style={styles.tabContent}>
                  <View
                    style={[
                      styles.tabDot,
                      isActive && styles.tabDotActive,
                    ]}
                  />
                  <Text
                    style={[
                      styles.tabLabel,
                      isActive && styles.tabLabelActive,
                    ]}
                    numberOfLines={1}
                  >
                    {page.shortTitle}
                  </Text>
                </View>
              </Pressable>
            </Link>
          );
        })}
      </View>
      {children}
    </SafeAreaView>
  );
}

// =====================================
// STYLES
// =====================================

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.bg,
  },
  scroll: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  header: {
    backgroundColor: C.navy,
    paddingHorizontal: 28,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  headerMobile: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerInner: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logo: {
    width: 58,
    height: 58,
    backgroundColor: C.white,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: {
    width: 56,
    height: 56,
  },
  brandTitle: {
    color: C.white,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  brandSubtitle: {
    color: '#C7D8E9',
    fontSize: 11,
    marginTop: 5,
  },
  connection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#EAF7EF',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  connectionOnline: {
    backgroundColor: '#E9F6EE',
  },
  connectionError: {
    backgroundColor: '#FCEEEE',
  },
  connectionDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#AAB5C1',
  },
  connectionText: {
    color: C.text,
    fontSize: 10,
    fontWeight: '700',
  },
  dashboardHero: {
    backgroundColor: C.navy,
    borderRadius: 20,
    padding: 22,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    overflow: 'hidden',
  },
  dashboardHeroCopy: { flex: 1 },
  dashboardEyebrow: { color: '#A9D2F7', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  dashboardTitle: { color: C.white, fontSize: 25, fontWeight: '800', marginTop: 5 },
  dashboardDate: { color: '#D2E1F0', fontSize: 12, marginTop: 7 },
  dashboardApiBadge: { backgroundColor: '#E6F7EF', borderRadius: 20, paddingHorizontal: 11, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  dashboardApiBadgeError: { backgroundColor: '#FCEEEE' },
  dashboardApiDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.green },
  dashboardApiDotError: { backgroundColor: C.red },
  dashboardApiText: { color: C.green, fontSize: 10, fontWeight: '800' },
  dashboardApiTextError: { color: C.red },
  dashboardStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  dashboardStatCard: { flexGrow: 1, flexBasis: 150, minWidth: 135, borderRadius: 16, padding: 16, borderWidth: 1 },
  dashboardStatBlue: { backgroundColor: '#EDF5FF', borderColor: '#D9E9FC' },
  dashboardStatGreen: { backgroundColor: '#ECF8F1', borderColor: '#D9F0E2' },
  dashboardStatPurple: { backgroundColor: '#F3F0FF', borderColor: '#E5DFFF' },
  dashboardStatOrange: { backgroundColor: '#FFF5E9', borderColor: '#F8E7CF' },
  dashboardStatLabel: { color: C.muted, fontSize: 11, fontWeight: '700' },
  dashboardStatValue: { color: C.navy, fontSize: 28, fontWeight: '800', marginTop: 9 },
  dashboardStatTotal: { color: C.muted, fontSize: 15, fontWeight: '700' },
  dashboardStatHint: { color: C.muted, fontSize: 10, marginTop: 3 },
  dashboardSeeAll: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: '#EDF5FF' },
  dashboardSeeAllText: { color: C.blue, fontSize: 11, fontWeight: '800' },
  dashboardRecentRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  dashboardAvatar: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#EAF3FC', alignItems: 'center', justifyContent: 'center' },
  dashboardAvatarText: { color: C.blue, fontSize: 15, fontWeight: '800' },
  dashboardRecentDetails: { flex: 1, minWidth: 0 },
  dashboardRecentName: { color: C.text, fontSize: 13, fontWeight: '800' },
  dashboardRecentMeta: { color: C.muted, fontSize: 10, marginTop: 4 },
  dashboardRecentRight: { alignItems: 'flex-end', gap: 5 },
  dashboardStatus: { borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4, fontSize: 10, fontWeight: '800', overflow: 'hidden' },
  dashboardStatusPresent: { color: C.green, backgroundColor: C.greenBg },
  dashboardStatusLate: { color: C.orange, backgroundColor: C.orangeBg },
  dashboardRecentTime: { color: C.muted, fontSize: 10 },
  main: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingTop: 25,
  },
  mainMobile: {
    paddingHorizontal: 15,
    paddingTop: 20,
  },
  pageHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  pageTitle: {
    color: C.text,
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  subtitle: {
    color: C.muted,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 20,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 20,
  },
  analyticsStats: {
    marginTop: 16,
    marginBottom: 10,
  },
  analyticsStat: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 140,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 15,
    backgroundColor: '#F7FAFD',
  },
  analyticsValue: {
    fontSize: 24,
    fontWeight: '800',
    marginTop: 5,
  },
  chartTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 13,
  },
  attendanceChartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  attendanceChartStudent: {
    width: 145,
    minWidth: 85,
  },
  chartStudentName: {
    color: C.text,
    fontSize: 11,
    fontWeight: '700',
  },
  chartStudentId: {
    color: C.muted,
    fontSize: 9,
    marginTop: 3,
  },
  attendanceBarTrack: {
    flex: 1,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#E9EEF3',
    overflow: 'hidden',
  },
  attendanceBar: {
    height: '100%',
    borderRadius: 5,
  },
  attendanceChartValue: {
    width: 36,
    color: C.text,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'right',
  },
  attendanceChartCount: {
    width: 48,
    color: C.muted,
    fontSize: 9,
    textAlign: 'right',
  },
  courseAnalyticsRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  courseAnalyticsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  courseAnalyticsDetails: {
    flex: 1,
    minWidth: 0,
  },
  courseAnalyticsName: {
    color: C.text,
    fontSize: 12,
    fontWeight: '700',
  },
  courseAnalyticsMeta: {
    color: C.muted,
    fontSize: 10,
    marginTop: 4,
  },
  courseAnalyticsRate: {
    width: 48,
    color: C.blue,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'right',
  },
  courseAnalyticsCounts: {
    color: C.muted,
    fontSize: 10,
    marginTop: 6,
  },
  statsMobile: {
    gap: 10,
  },
  statWrap: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 145,
  },
  statCard: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 17,
    padding: 18,
    minHeight: 132,
    shadowColor: '#16324F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.045,
    shadowRadius: 12,
    elevation: 2,
  },
  statAccent: {
    width: 30,
    height: 4,
    borderRadius: 3,
    marginBottom: 14,
  },
  statLabel: {
    color: C.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  statValue: {
    color: C.navy,
    fontSize: 32,
    fontWeight: '800',
    marginTop: 12,
  },
  statNote: {
    color: C.muted,
    fontSize: 10,
    marginTop: 6,
  },
  panel: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    padding: 22,
    marginBottom: 18,
    shadowColor: '#16324F',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.045,
    shadowRadius: 14,
    elevation: 2,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18,
  },
  sectionTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
  },
  resultCount: {
    color: C.navy,
    backgroundColor: '#EAF3FC',
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 12,
    fontSize: 11,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: '#FBFCFE',
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 13,
    color: C.text,
    marginBottom: 16,
  },
  fieldLabel: {
    color: C.text,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  dateText: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    color: C.text,
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  button: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.white,
    borderRadius: 11,
    paddingHorizontal: 15,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonActive: {
    backgroundColor: C.blue,
    borderColor: C.blue,
  },
  buttonDanger: {
    backgroundColor: C.red,
    borderColor: C.red,
  },
  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: C.text,
    fontSize: 12,
    fontWeight: '700',
  },
  buttonTextActive: {
    color: C.white,
  },
  updateInfo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 13,
    marginTop: 17,
  },
  updateText: {
    color: C.muted,
    fontSize: 11,
    flexShrink: 1,
  },
  autoRefresh: {
    color: C.muted,
    fontSize: 10,
  },
  messageBox: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 10,
  },
  inlineLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
  },
  messageText: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 19,
  },
  errorBox: {
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: '#EBCACA',
    padding: 15,
    borderRadius: 13,
    gap: 10,
    marginBottom: 15,
  },
  errorTitle: {
    color: C.red,
    fontSize: 13,
    fontWeight: '800',
  },
  successBox: {
    backgroundColor: C.greenBg,
    borderWidth: 1,
    borderColor: '#C5E5D0',
    padding: 12,
    borderRadius: 13,
    marginBottom: 14,
  },
  successText: {
    color: C.green,
    fontSize: 12,
    lineHeight: 19,
  },
  warningBox: {
    backgroundColor: C.orangeBg,
    padding: 12,
    borderRadius: 13,
    marginBottom: 12,
  },
  warningText: {
    color: C.orange,
    fontSize: 11,
    lineHeight: 18,
  },
  dismissButton: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
  },
  dismissText: {
    color: C.red,
    fontSize: 12,
    fontWeight: '700',
  },
  record: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 15,
    padding: 17,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  recordTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  studentName: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
  },
  studentId: {
    color: C.muted,
    fontSize: 11,
    marginTop: 5,
  },
  status: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  statusPresent: {
    backgroundColor: C.greenBg,
  },
  statusLate: {
    backgroundColor: '#FFF4E5',
  },
  statusOther: {
    backgroundColor: '#EDF0F3',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusTextPresent: {
    color: C.green,
  },
  statusTextLate: {
    color: '#B45309',
  },
  statusTextOther: {
    color: C.muted,
  },
  deviceStatusOffline: {
    backgroundColor: C.redBg,
  },
  deviceStatusOfflineText: {
    color: C.red,
  },
  recordDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 15,
    borderTopWidth: 1,
    borderTopColor: C.border,
    marginTop: 14,
    paddingTop: 13,
  },
  detailItem: {
    minWidth: 110,
  },
  uidItem: {
    flexGrow: 1,
    minWidth: 120,
  },
  detailLabel: {
    color: C.muted,
    fontSize: 10,
    marginBottom: 5,
  },
  detailValue: {
    color: C.text,
    fontSize: 12,
    fontWeight: '600',
  },
  recordActions: {
    alignItems: 'flex-start',
    marginTop: 13,
  },
  deleteButton: {
    backgroundColor: C.red,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonText: {
    color: C.white,
    fontSize: 11,
    fontWeight: '700',
  },
  listHeading: {
    color: C.text,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 22,
    marginBottom: 8,
  },
  formHint: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: -9,
    marginBottom: 14,
  },
  formRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  formField: {
    flex: 1,
    minWidth: 130,
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  manageDetails: {
    flex: 1,
    minWidth: 0,
  },
  manageActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
  },
  note: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 15,
  },
  voicePanel: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 17,
    padding: 22,
    marginBottom: 18,
    gap: 12,
    alignItems: 'flex-start',
  },
  voiceTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '800',
  },
  voiceText: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 20,
  },
  sensorSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  sensorSummaryCard: {
    flex: 1,
    minWidth: 150,
    backgroundColor: '#F4F8FC',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 15,
    padding: 17,
  },
  sensorTemperature: {
    color: C.blue,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 8,
  },
  sensorHumidity: {
    color: C.green,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 8,
  },
  sensorChartTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 8,
  },
  sensorChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    minHeight: 135,
    padding: 10,
    paddingTop: 18,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    marginBottom: 12,
    backgroundColor: '#FBFCFE',
  },
  sensorBarColumn: { width: 46, alignItems: 'center', justifyContent: 'flex-end' },
  sensorBarValue: { color: C.text, fontSize: 9, marginBottom: 4 },
  sensorBar: { width: '70%', minWidth: 5, borderRadius: 3 },
  sensorBarTime: { color: C.muted, fontSize: 8, marginTop: 5 },
  sensorThresholdRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  sensorThresholdCard: {
    flex: 1,
    minWidth: 125,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 13,
    padding: 14,
  },
  sensorThresholdInput: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    backgroundColor: C.white,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 7,
    color: C.text,
    fontSize: 14,
  },
  sensorThresholdNote: {
    color: C.muted,
    fontSize: 10,
    marginTop: 6,
  },
  sensorAlertValue: {
    color: C.red,
  },
  sensorWarning: {
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: '#EBCACA',
    borderRadius: 13,
    padding: 12,
    marginBottom: 12,
  },
  sensorWarningTitle: {
    color: C.red,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 5,
  },
  abnormalHistory: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 5,
    marginTop: 5,
  },
  abnormalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  abnormalValue: {
    color: C.red,
    fontSize: 11,
    fontWeight: '700',
  },
  offlineAlertSettings: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  offlineThresholdInput: {
    width: 90,
    marginBottom: 0,
    paddingVertical: 9,
  },
  validationText: {
    color: C.red,
    fontSize: 11,
    marginBottom: 10,
  },
  offlineAlert: {
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: '#EBCACA',
    borderRadius: 13,
    padding: 12,
    marginBottom: 10,
  },
  offlineAlertTitle: {
    color: C.red,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 5,
  },
  deviceEvents: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    marginTop: 14,
    paddingTop: 4,
  },
  deviceEventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  eventDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  eventDotOnline: {
    backgroundColor: C.green,
  },
  eventDotOffline: {
    backgroundColor: C.red,
  },
  deviceEventTitle: {
    color: C.text,
    fontSize: 11,
    fontWeight: '700',
  },
  deviceEventTime: {
    color: C.muted,
    fontSize: 10,
    marginTop: 3,
  },
  auditRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  auditDetails: {
    flex: 1,
    gap: 3,
  },
  auditTitle: {
    color: C.text,
    fontSize: 12,
    fontWeight: '700',
  },
  auditMeta: {
    color: C.muted,
    fontSize: 10,
    lineHeight: 15,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 22,
  },
  footerTitle: {
    color: C.navy,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  footerText: {
    color: C.muted,
    fontSize: 10,
    marginTop: 7,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-around',
    backgroundColor: C.white,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'web' ? 8 : 12,
    shadowColor: '#16324F',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 8,
  },
  tabItem: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    paddingHorizontal: 4,
  },
  tabItemActive: {
    backgroundColor: '#EAF3FC',
  },
  tabItemPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.97 }],
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'transparent',
  },
  tabDotActive: {
    backgroundColor: C.blue,
  },
  tabLabel: {
    color: C.muted,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  tabLabelActive: {
    color: C.blue,
    fontWeight: '800',
  },
});
