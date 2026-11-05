#include <SPI.h>
#include <MFRC522.h>
#include <U8g2lib.h>
#include <DHT.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DFRobotDFPlayerMini.h>
#include <ArduinoJson.h>
#include "ThaiOLED_Bitmaps.h"

// =====================================
// PIN CONFIGURATION
// =====================================

#define RST_PIN 22
#define SS_PIN 5
#define SCK_PIN 18
#define MISO_PIN 19
#define MOSI_PIN 23

#define OLED_SDA 21
#define OLED_SCL 32

#define LED_R 25
#define LED_G 26
#define LED_B 27
#define LED_COMMON_ANODE false

#define BUZZER_PIN 4
#define BUZZ_FREQ 2700

#define BUTTON_PIN 13

#define DHT_PIN 14
#define DHT_TYPE DHT11

#define DFPLAYER_RX 16
#define DFPLAYER_TX 17

// =====================================
// WIFI + API
// =====================================

const char* WIFI_SSID = "ya";
const char* WIFI_PASSWORD = "22222222";

const char* API_URL =
  "https://smart-attendance-api-b3nv.onrender.com/api/attendance";

const char* HEARTBEAT_URL =
  "https://smart-attendance-api-b3nv.onrender.com/api/device/heartbeat";

const char* DHT_HISTORY_URL =
  "https://smart-attendance-api-b3nv.onrender.com/api/sensors/dht11";

const char* TEMP_ALERT_URL =
  "https://smart-attendance-api-b3nv.onrender.com/api/settings/temperature-alert";

const char* DEVICE_ID = "ESP32-ATTENDANCE-01";

// Heartbeat
const unsigned long HEARTBEAT_INTERVAL = 20000;
unsigned long lastHeartbeatTime = 0;

// DHT history
const unsigned long DHT_UPLOAD_INTERVAL = 30000;
unsigned long lastDHTUpload = 0;

// Temperature threshold refresh
const unsigned long THRESHOLD_FETCH_INTERVAL = 30000;
unsigned long lastThresholdFetch = 0;

// Default value if API is temporarily unavailable
float tempAlertThreshold = 35.0;

// Hysteresis: re-arm alert after temperature drops below 34°C
const float TEMP_ALERT_RESET_C = 34.0;
bool temperatureAlertActive = false;

// OLED animation
unsigned long lastAnimationFrame = 0;
const unsigned long ANIMATION_INTERVAL = 70;

// =====================================
// DEVICES
// =====================================

MFRC522 rfid(SS_PIN, RST_PIN);

U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(
  U8G2_R0,
  U8X8_PIN_NONE,
  OLED_SCL,
  OLED_SDA
);

DHT dht(DHT_PIN, DHT_TYPE);

HardwareSerial dfSerial(2);
DFRobotDFPlayerMini dfPlayer;
bool dfPlayerReady = false;

// =====================================
// STUDENT DATABASE
// =====================================

struct Student {
  byte uid[4];
  const char* name;
  const char* studentId;
};

Student students[] = {
  {{0xFA, 0xD4, 0x46, 0x5C},
   "Sakareeya Mandaenghe", "69409010003"},

  {{0x3A, 0x2A, 0xFA, 0x5B},
   "Kamal Jehmi", "694090001"},

  {{0xEC, 0x3C, 0x03, 0x07},
   "Khanchitpol Phengeiat", "694090002"}
};

const int STUDENT_COUNT =
  sizeof(students) / sizeof(students[0]);

// =====================================
// SCREEN STATE
// =====================================

enum ScreenMode {
  SCREEN_ATTENDANCE,
  SCREEN_TEMPERATURE
};

ScreenMode currentScreen = SCREEN_ATTENDANCE;

float temperature = NAN;
float humidity = NAN;

unsigned long lastDHTRead = 0;
const unsigned long DHT_INTERVAL = 2500;

bool showingResult = false;
unsigned long resultStartedAt = 0;
const unsigned long RESULT_DURATION = 2500;

String lastScannedUID = "";
unsigned long lastScanTime = 0;
const unsigned long SAME_CARD_DELAY = 1800;

// Button debounce
bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long DEBOUNCE_MS = 40;

// =====================================
// WIFI
// =====================================

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");

  int attempts = 0;

  while (WiFi.status() != WL_CONNECTED &&
         attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi connected!");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Wi-Fi RSSI: ");
    Serial.println(WiFi.RSSI());
  } else {
    Serial.println("Wi-Fi connection failed");
  }
}

// =====================================
// TEMPERATURE ALERT SETTINGS API
// =====================================

void fetchTemperatureThreshold() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("THRESHOLD: Wi-Fi offline");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // ใช้ทดสอบ HTTPS; ควรเปลี่ยนเป็นตรวจ certificate ในงานใช้งานจริง
  HTTPClient http;

  http.setTimeout(3000);

  if (!http.begin(client, TEMP_ALERT_URL)) {
    Serial.println("THRESHOLD: Cannot start connection");
    return;
  }

  int httpCode = http.GET();

  Serial.print("Threshold API HTTP status: ");
  Serial.println(httpCode);

  if (httpCode == HTTP_CODE_OK) {
    String response = http.getString();

    Serial.println("Threshold API response:");
    Serial.println(response);

    // Parse JSON response:
    // {"success":true,"data":{"threshold":35,"min":20,"max":50,"unit":"°C"}}
    JsonDocument doc;
    DeserializationError error =
      deserializeJson(doc, response);

    if (!error) {
      bool success = doc["success"] | false;

      if (success && !doc["data"]["threshold"].isNull()) {
        float value = doc["data"]["threshold"].as<float>();

        float minValue = doc["data"]["min"] | 20.0;
        float maxValue = doc["data"]["max"] | 50.0;

        if (value >= minValue && value <= maxValue) {
          tempAlertThreshold = value;

          Serial.print("Temperature alert threshold updated: ");
          Serial.print(tempAlertThreshold, 1);
          Serial.println(" C");
        } else {
          Serial.println("THRESHOLD: Value out of range");
        }
      } else {
        Serial.println("THRESHOLD: Invalid API response");
      }
    } else {
      Serial.print("THRESHOLD JSON error: ");
      Serial.println(error.c_str());
    }
  } else {
    Serial.println("THRESHOLD: Failed to fetch settings");

    if (httpCode < 0) {
      Serial.println(http.errorToString(httpCode));
    } else {
      Serial.println(http.getString());
    }
  }

  http.end();
}

// =====================================
// DFPLAYER
// =====================================

void setupDFPlayer() {
  dfSerial.begin(
    9600,
    SERIAL_8N1,
    DFPLAYER_RX,
    DFPLAYER_TX
  );

  delay(1000);

  Serial.println("Initializing DFPlayer Mini...");

  if (dfPlayer.begin(dfSerial)) {
    dfPlayerReady = true;
    dfPlayer.volume(25);
    dfPlayer.EQ(DFPLAYER_EQ_NORMAL);

    delay(500);

    Serial.println("DFPlayer connected!");
    Serial.println("Audio files: /MP3/0001.mp3 - /MP3/0006.mp3");
  } else {
    dfPlayerReady = false;
    Serial.println("DFPlayer initialization failed!");
    Serial.println("Check wiring, power and microSD.");
  }
}

void playSound(uint8_t trackNumber, const char* description) {
  if (!dfPlayerReady) {
    Serial.println("Audio skipped: DFPlayer not ready");
    return;
  }

  Serial.print("Playing file ");
  Serial.print(trackNumber);
  Serial.print(": ");
  Serial.println(description);

  dfPlayer.play(trackNumber);
}

void playAttendanceSuccess() {
  playSound(1, "Attendance success");
}

void playUnknownCard() {
  playSound(2, "Unknown card");
}

void playDuplicateCard() {
  playSound(3, "Duplicate attendance");
}

void playApiError() {
  playSound(4, "API connection error");
}

void playReadySound() {
  playSound(5, "Device ready");
}

void playTemperatureAlert() {
  playSound(6, "Temperature alert");
}

// =====================================
// HEARTBEAT
// =====================================

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("HEARTBEAT: Wi-Fi offline");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // ใช้ทดสอบ HTTPS; ควรเปลี่ยนเป็นตรวจ certificate ในงานใช้งานจริง
  HTTPClient http;

  http.setTimeout(3000);

  if (!http.begin(client, HEARTBEAT_URL)) {
    Serial.println("HEARTBEAT: Cannot start connection");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  String body = "{";
  body += "\"deviceId\":\"";
  body += DEVICE_ID;
  body += "\",";
  body += "\"ip\":\"";
  body += WiFi.localIP().toString();
  body += "\",";
  body += "\"rssi\":";
  body += String(WiFi.RSSI());
  body += "}";

  int httpCode = http.POST(body);

  Serial.print("Heartbeat HTTP status: ");
  Serial.println(httpCode);

  if (httpCode >= 200 && httpCode < 300) {
    Serial.println("HEARTBEAT SUCCESS");
    Serial.println(http.getString());
  } else {
    Serial.println("HEARTBEAT FAILED");

    if (httpCode < 0) {
      Serial.println(http.errorToString(httpCode));
    } else {
      Serial.println(http.getString());
    }
  }

  http.end();
}

// =====================================
// SEND DHT11 HISTORY
// =====================================

void sendDHTHistory() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("DHT API: Wi-Fi offline");
    return;
  }

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("DHT API: No valid sensor reading");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // ใช้ทดสอบ HTTPS; ควรเปลี่ยนเป็นตรวจ certificate ในงานใช้งานจริง
  HTTPClient http;

  http.setTimeout(5000);

  if (!http.begin(client, DHT_HISTORY_URL)) {
    Serial.println("DHT API: Cannot start connection");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  String body = "{";
  body += "\"deviceId\":\"";
  body += DEVICE_ID;
  body += "\",";
  body += "\"temperature\":";
  body += String(temperature, 1);
  body += ",";
  body += "\"humidity\":";
  body += String(humidity, 1);
  body += "}";

  Serial.println("Sending DHT11 history:");
  Serial.println(body);

  int httpCode = http.POST(body);

  Serial.print("DHT API HTTP status: ");
  Serial.println(httpCode);

  if (httpCode >= 200 && httpCode < 300) {
    Serial.println("DHT HISTORY SAVED");
    Serial.println(http.getString());
  } else {
    Serial.println("DHT HISTORY SAVE FAILED");

    if (httpCode < 0) {
      Serial.println(http.errorToString(httpCode));
    } else {
      Serial.println(http.getString());
    }
  }

  http.end();
}

// =====================================
// SEND ATTENDANCE TO API
// 1 = success, 0 = duplicate, -1 = error
// =====================================

int sendAttendanceToAPI(
  const Student& student,
  const String& cardUID
) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("API ERROR: Wi-Fi offline");
    return -1;
  }

  WiFiClientSecure client;
  client.setInsecure(); // ใช้ทดสอบ HTTPS; ควรเปลี่ยนเป็นตรวจ certificate ในงานใช้งานจริง
  HTTPClient http;

  http.setTimeout(5000);

  if (!http.begin(client, API_URL)) {
    Serial.println("Cannot start API connection");
    return -1;
  }

  http.addHeader("Content-Type", "application/json");

  String body = "{";

  body += "\"deviceId\":\"";
  body += DEVICE_ID;
  body += "\",";

  body += "\"uid\":\"";
  body += cardUID;
  body += "\",";

  body += "\"name\":\"";
  body += student.name;
  body += "\",";

  body += "\"studentId\":\"";
  body += student.studentId;
  body += "\",";

  body += "\"temperature\":";
  body += isnan(temperature)
    ? String("null")
    : String(temperature, 1);

  body += ",";

  body += "\"humidity\":";
  body += isnan(humidity)
    ? String("null")
    : String(humidity, 1);

  body += "}";

  Serial.println("Sending attendance to API:");
  Serial.println(body);

  int httpCode = http.POST(body);
  String response = http.getString();

  Serial.print("Attendance HTTP status: ");
  Serial.println(httpCode);

  Serial.println("API response:");
  Serial.println(response);

  http.end();

  if (httpCode == 200 || httpCode == 201) {
    Serial.println("ATTENDANCE API SUCCESS");
    return 1;
  }

  if (httpCode == 409) {
    Serial.println("ATTENDANCE ALREADY EXISTS IN API");
    return 0;
  }

  Serial.println("ATTENDANCE API ERROR");

  if (httpCode < 0) {
    Serial.println("HTTP request failed");
  }

  return -1;
}

// =====================================
// RGB LED
// =====================================

void setLed(bool red, bool green, bool blue) {
  digitalWrite(LED_R, LED_COMMON_ANODE ? !red : red);
  digitalWrite(LED_G, LED_COMMON_ANODE ? !green : green);
  digitalWrite(LED_B, LED_COMMON_ANODE ? !blue : blue);
}

// =====================================
// BUZZER
// =====================================

void beep(int durationMs) {
  tone(BUZZER_PIN, BUZZ_FREQ);
  delay(durationMs);
  noTone(BUZZER_PIN);
}

// =====================================
// THAI BITMAP HELPER
// =====================================

void drawThai(
  const uint8_t* bitmap,
  uint8_t width,
  uint8_t height,
  int x,
  int y
) {
  oled.drawXBMP(x, y, width, height, bitmap);
}

// =====================================
// OLED: WAITING ROBOT
// =====================================

void showReady() {
  unsigned long t = millis();

  unsigned long blinkTime = t % 3200;
  bool blink = (blinkTime > 120 && blinkTime < 260);

  int bob = ((t / 250) % 2 == 0) ? 0 : 1;
  bool mouthOpen = ((t / 300) % 2 == 0);
  int look = (int)((t / 900) % 3) - 1;

  oled.clearBuffer();

  oled.drawLine(64, 8 + bob, 64, 3 + bob);
  oled.drawDisc(64, 3 + bob, 3);

  oled.drawRFrame(15, 9 + bob, 98, 53, 17);

  oled.drawRBox(5, 25 + bob, 12, 23, 4);
  oled.drawRBox(111, 25 + bob, 12, 23, 4);

  if (blink) {
    oled.drawLine(31, 29 + bob, 49, 29 + bob);
    oled.drawLine(79, 29 + bob, 97, 29 + bob);
  } else {
    oled.drawDisc(40, 29 + bob, 11);
    oled.drawDisc(88, 29 + bob, 11);

    oled.setDrawColor(0);
    oled.drawDisc(40 + look, 29 + bob, 7);
    oled.drawDisc(88 + look, 29 + bob, 7);
    oled.drawDisc(37 + look, 26 + bob, 2);
    oled.drawDisc(85 + look, 26 + bob, 2);
    oled.setDrawColor(1);
  }

  oled.drawDisc(26, 43 + bob, 3);
  oled.drawDisc(102, 43 + bob, 3);

  if (mouthOpen) {
    oled.drawCircle(64, 43 + bob, 5, U8G2_DRAW_ALL);
    oled.drawHLine(60, 40 + bob, 8);
  } else {
    oled.drawLine(55, 43 + bob, 73, 43 + bob);
  }

  oled.drawRFrame(43, 54 + bob, 42, 10, 4);
  oled.drawDisc(55, 59 + bob, 2);
  oled.drawDisc(73, 59 + bob, 2);

  oled.sendBuffer();
}

// =====================================
// OLED: STARTING SCREEN
// =====================================

void showStarting() {
  oled.clearBuffer();

  drawThai(
    TH_STARTING_BITMAP,
    TH_STARTING_W,
    TH_STARTING_H,
    0, 10
  );

  drawThai(
    TH_WAIT_BITMAP,
    TH_WAIT_W,
    TH_WAIT_H,
    0, 35
  );

  oled.sendBuffer();
}

// =====================================
// OLED: ATTENDANCE SUCCESS
// =====================================

void showSuccess(
  const char* name,
  const char* studentId
) {
  oled.clearBuffer();

  drawThai(
    TH_SUCCESS_BITMAP,
    TH_SUCCESS_W,
    TH_SUCCESS_H,
    0, 2
  );

  oled.setFont(u8g2_font_5x8_tf);
  oled.drawStr(0, 29, "Name:");
  oled.drawUTF8(0, 40, name);
  oled.drawStr(0, 51, "ID:");
  oled.drawStr(0, 62, studentId);

  oled.sendBuffer();
}

// =====================================
// OLED: DUPLICATE CARD
// =====================================

void showDuplicate() {
  oled.clearBuffer();

  drawThai(
    TH_ALREADY_BITMAP,
    TH_ALREADY_W,
    TH_ALREADY_H,
    0, 8
  );

  drawThai(
    TH_DUPLICATE_BITMAP,
    TH_DUPLICATE_W,
    TH_DUPLICATE_H,
    0, 35
  );

  oled.sendBuffer();
}

// =====================================
// OLED: UNKNOWN CARD
// =====================================

void showUnknownCard() {
  oled.clearBuffer();

  drawThai(
    TH_UNKNOWN_BITMAP,
    TH_UNKNOWN_W,
    TH_UNKNOWN_H,
    0, 5
  );

  drawThai(
    TH_CONTACT_BITMAP,
    TH_CONTACT_W,
    TH_CONTACT_H,
    0, 30
  );

  oled.sendBuffer();
}

// =====================================
// OLED: ERROR
// =====================================

void showRFIDError() {
  oled.clearBuffer();

  oled.setFont(u8g2_font_6x10_tf);
  oled.drawStr(0, 20, "API / RFID ERROR");
  oled.drawStr(0, 40, "Check Serial Monitor");

  oled.sendBuffer();
}

// =====================================
// OLED: TEMPERATURE / HUMIDITY
// =====================================

void showTemperature() {
  oled.clearBuffer();

  oled.setFont(u8g2_font_6x10_tf);
  oled.drawStr(0, 10, "ROOM MONITOR");
  oled.drawHLine(0, 15, 128);

  oled.setFont(u8g2_font_helvB12_tf);

  if (isnan(temperature)) {
    oled.drawStr(0, 34, "Temp: --.- C");
  } else {
    char tempText[24];

    snprintf(
      tempText,
      sizeof(tempText),
      "Temp: %.1f C",
      temperature
    );

    oled.drawStr(0, 34, tempText);
  }

  if (isnan(humidity)) {
    oled.drawStr(0, 53, "Hum: -- %");
  } else {
    char humText[24];

    snprintf(
      humText,
      sizeof(humText),
      "Hum: %.1f %% ",
      humidity
    );

    oled.drawStr(0, 53, humText);
  }

  oled.setFont(u8g2_font_5x8_tf);
  oled.drawStr(0, 63, "Press button: Attendance");

  oled.sendBuffer();
}

// =====================================
// FIND STUDENT BY UID
// =====================================

int findStudent(byte* uid, byte uidSize) {
  if (uidSize != 4) {
    return -1;
  }

  for (int i = 0; i < STUDENT_COUNT; i++) {
    bool match = true;

    for (byte j = 0; j < 4; j++) {
      if (students[i].uid[j] != uid[j]) {
        match = false;
        break;
      }
    }

    if (match) {
      return i;
    }
  }

  return -1;
}

// =====================================
// READ DHT11 + TEMPERATURE ALERT
// =====================================

void updateDHT() {
  unsigned long now = millis();

  if (now - lastDHTRead < DHT_INTERVAL) {
    return;
  }

  lastDHTRead = now;

  float newHumidity = dht.readHumidity();
  float newTemperature = dht.readTemperature();

  if (!isnan(newHumidity) && !isnan(newTemperature)) {
    humidity = newHumidity;
    temperature = newTemperature;

    Serial.print("Temperature: ");
    Serial.print(temperature);
    Serial.println(" C");

    Serial.print("Humidity: ");
    Serial.print(humidity);
    Serial.println(" %");

    Serial.print("Alert threshold: ");
    Serial.print(tempAlertThreshold);
    Serial.println(" C");

    // Play alert only once while temperature remains high.
    if (temperature >= tempAlertThreshold &&
        !temperatureAlertActive) {
      temperatureAlertActive = true;

      Serial.println("TEMPERATURE ALERT!");
      playTemperatureAlert();
    }
    // Re-arm after temperature falls below reset temperature.
    else if (temperature < TEMP_ALERT_RESET_C) {
      temperatureAlertActive = false;
    }
  } else {
    Serial.println("DHT11 read failed");
  }
}

// =====================================
// BUTTON HANDLER
// =====================================

void checkButton() {
  bool reading = digitalRead(BUTTON_PIN);
  unsigned long now = millis();

  if (reading != lastButtonReading) {
    lastDebounceTime = now;
    lastButtonReading = reading;
  }

  if (now - lastDebounceTime >= DEBOUNCE_MS) {
    if (reading != stableButtonState) {
      stableButtonState = reading;

      if (stableButtonState == LOW) {
        if (currentScreen == SCREEN_ATTENDANCE) {
          currentScreen = SCREEN_TEMPERATURE;
        } else {
          currentScreen = SCREEN_ATTENDANCE;
        }

        showingResult = false;

        Serial.print("Screen changed to: ");
        Serial.println(
          currentScreen == SCREEN_ATTENDANCE
            ? "ATTENDANCE"
            : "TEMPERATURE"
        );

        setLed(false, false, false);
        beep(60);

        if (currentScreen == SCREEN_TEMPERATURE) {
          showTemperature();
        } else {
          showReady();
          lastAnimationFrame = millis();
        }
      }
    }
  }
}

// =====================================
// RFID ATTENDANCE
// =====================================

void checkAttendance() {
  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  String cardUID = "";

  Serial.print("Card UID: ");

  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) {
      Serial.print('0');
      cardUID += "0";
    }

    Serial.print(rfid.uid.uidByte[i], HEX);
    cardUID += String(rfid.uid.uidByte[i], HEX);

    if (i < rfid.uid.size - 1) {
      Serial.print(' ');
    }
  }

  cardUID.toUpperCase();
  Serial.println();

  unsigned long now = millis();

  if (cardUID == lastScannedUID &&
      now - lastScanTime < SAME_CARD_DELAY) {
    Serial.println("Same card scanned too quickly; ignored.");

    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  lastScannedUID = cardUID;
  lastScanTime = now;

  int index = findStudent(
    rfid.uid.uidByte,
    rfid.uid.size
  );

  if (index < 0) {
    Serial.println("RESULT: UNKNOWN CARD");

    showUnknownCard();
    setLed(true, false, false);
    beep(250);
    playUnknownCard();
  } else {
    Student &student = students[index];

    Serial.print("Name: ");
    Serial.println(student.name);

    Serial.print("Student ID: ");
    Serial.println(student.studentId);

    int result = sendAttendanceToAPI(student, cardUID);

    if (result == 1) {
      Serial.println("RESULT: SUCCESS");

      showSuccess(student.name, student.studentId);
      setLed(false, true, false);
      beep(150);
      playAttendanceSuccess();
    } else if (result == 0) {
      Serial.println("RESULT: DUPLICATE IN DATABASE");

      showDuplicate();
      setLed(true, true, false);
      beep(250);
      playDuplicateCard();
    } else {
      Serial.println("RESULT: API FAILED - RETRY ALLOWED");

      showRFIDError();
      setLed(true, false, false);
      beep(400);
      playApiError();
    }
  }

  showingResult = true;
  resultStartedAt = millis();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// =====================================
// SETUP
// =====================================

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  setLed(false, false, false);
  noTone(BUZZER_PIN);

  oled.begin();
  showStarting();
  delay(1000);

  dht.begin();

  setupDFPlayer();

  connectWiFi();

  // Load the UI-configured threshold immediately after Wi-Fi connects.
  fetchTemperatureThreshold();
  lastThresholdFetch = millis();

  SPI.begin(
    SCK_PIN,
    MISO_PIN,
    MOSI_PIN,
    SS_PIN
  );

  rfid.PCD_Init();
  delay(100);

  byte version = rfid.PCD_ReadRegister(
    MFRC522::VersionReg
  );

  Serial.println();
  Serial.println("ESP32 RFID ATTENDANCE BOX");
  Serial.println("=========================");
  Serial.print("RC522 Firmware: 0x");
  Serial.println(version, HEX);

  if (version == 0x00 || version == 0xFF) {
    Serial.println("ERROR: Check RC522 communication");

    showRFIDError();
    setLed(true, false, false);

    return;
  }

  Serial.println("Attendance Box Ready");
  Serial.println("Scan your RFID card...");

  showReady();

  setLed(false, false, true);
  beep(100);
  delay(300);
  setLed(false, false, false);

  lastHeartbeatTime = millis();
  sendHeartbeat();

  playReadySound();

  updateDHT();

  lastDHTUpload = millis();
  lastAnimationFrame = millis();
}

// =====================================
// LOOP
// =====================================

void loop() {
  checkButton();
  updateDHT();
  checkAttendance();

  // Refresh temperature threshold every 30 seconds.
  if (millis() - lastThresholdFetch >=
      THRESHOLD_FETCH_INTERVAL) {
    lastThresholdFetch = millis();
    fetchTemperatureThreshold();
  }

  // Upload DHT history every 30 seconds.
  if (millis() - lastDHTUpload >= DHT_UPLOAD_INTERVAL) {
    lastDHTUpload = millis();
    sendDHTHistory();
  }

  // Heartbeat every 20 seconds.
  if (millis() - lastHeartbeatTime >= HEARTBEAT_INTERVAL) {
    lastHeartbeatTime = millis();
    sendHeartbeat();
  }

  // Return to waiting animation after displaying result.
  if (showingResult &&
      millis() - resultStartedAt >= RESULT_DURATION) {
    showingResult = false;
    setLed(false, false, false);
    lastAnimationFrame = 0;
  }

  // Animate only on attendance screen.
  if (!showingResult) {
    if (currentScreen == SCREEN_ATTENDANCE) {
      if (millis() - lastAnimationFrame >= ANIMATION_INTERVAL) {
        lastAnimationFrame = millis();
        showReady();
      }
    } else {
      showTemperature();
    }
  }

  delay(10);
}