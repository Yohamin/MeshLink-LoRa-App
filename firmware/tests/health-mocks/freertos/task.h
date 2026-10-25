#pragma once
using TaskHandle_t = void *;
using portMUX_TYPE = int;
#define portMUX_INITIALIZER_UNLOCKED 0
#define pdPASS 1
#define pdMS_TO_TICKS(ms) (ms)
inline void portENTER_CRITICAL(portMUX_TYPE *) {}
inline void portEXIT_CRITICAL(portMUX_TYPE *) {}
inline void vTaskDelay(int ticks) { mockNow += static_cast<uint32_t>(ticks); }
inline int xTaskCreate(void (*)(void *), const char *, int, void *, int, TaskHandle_t *task) {
  *task = reinterpret_cast<void *>(1); return pdPASS;
}
