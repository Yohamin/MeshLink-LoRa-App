#include "../max30102_sensor.h"
#include <assert.h>
#include <stdio.h>
int main() {
  static_assert(!MESH_HAS_MAX30102, "Sensor must remain disabled on this profile");
  MeshMax30102 sensor;
  assert(!sensor.begin() && !sensor.setEnabled(true));
  auto s = sensor.snapshot();
  assert(!s.enabled && !s.present && !s.heartValid && !s.spo2Valid);
  assert(!strcmp(s.state, "unsupported"));
  printf("MAX30102 disabled: profile %d PASS\n", MESH_BOARD_PROFILE);
}
