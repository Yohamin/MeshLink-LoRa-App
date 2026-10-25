#include "../health_signal.h"
#include <assert.h>
#include <stdio.h>

int main() {
  MeshHealthWindow window;
  uint32_t red[100], ir[100];
  assert(!window.copyForCalculation(red, ir));
  for (unsigned i = 0; i < 99; ++i) assert(!window.push(40000 + i * 2, 50000 + i * 3));
  assert(window.count == 99 && window.contact);
  assert(window.push(40198, 50297));
  assert(window.copyForCalculation(red, ir));
  assert(red[0] == 40000 && ir[99] == 50297);
  assert(!window.push(40200, 50300));
  assert(window.copyForCalculation(red, ir));
  assert(red[0] == 40002 && red[99] == 40200); // Ring order.
  assert(!window.push(100, 100));
  assert(window.count == 0 && !window.contact);
  assert(!window.copyForCalculation(red, ir));
  for (unsigned i = 0; i < 100; ++i) window.push(40000, 50000);
  assert(!window.copyForCalculation(red, ir)); // Flat signal.
  window.reset();
  for (unsigned i = 0; i < 100; ++i) window.push(100000 + i * 200, 200000 + i * 20);
  assert(!window.copyForCalculation(red, ir)); // Vendor int32 overflow guard.
  assert(!window.push(262143, 50000));
  assert(!window.contact && window.count == 0);
  puts("Health window: PASS (warmup, order, contact, flat, saturation, overflow)");
}
