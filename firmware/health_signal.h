#pragma once
#include <stdint.h>

// Signal guards, not clinical validation. Reset after every discontinuity.
class MeshHealthWindow {
 public:
  static constexpr unsigned size = 100; // 4 seconds at 25 FIFO samples/s.
  unsigned count = 0;
  bool contact = false;

  void reset() { count = cursor = sinceCalculation = 0; contact = false; }
  bool push(uint32_t red, uint32_t ir, uint32_t contactMinimum = 5000) {
    if (ir < contactMinimum || red < 250 || ir >= 260000 || red >= 260000) {
      reset();
      return false;
    }
    contact = true;
    reds[cursor] = red;
    infrared[cursor] = ir;
    cursor = (cursor + 1) % size;
    if (count < size) ++count;
    ++sinceCalculation;
    if (count == size && sinceCalculation >= 25) {
      sinceCalculation = 0;
      return true;
    }
    return false;
  }
  bool copyForCalculation(uint32_t *red, uint32_t *ir) const {
    if (!contact || count != size) return false;
    uint32_t low = 262143, high = 0, redLow = 262143, redHigh = 0;
    uint64_t sum = 0;
    for (unsigned i = 0; i < size; ++i) {
      unsigned at = (cursor + i) % size;
      red[i] = reds[at];
      ir[i] = infrared[at];
      if (ir[i] < low) low = ir[i];
      if (ir[i] > high) high = ir[i];
      if (red[i] < redLow) redLow = red[i];
      if (red[i] > redHigh) redHigh = red[i];
      sum += ir[i];
    }
    uint32_t dc = uint32_t(sum / size);
    // Flat, clipped or very large excursions cannot produce a displayed result.
    return high - low >= 100 && high - low <= dc / 5 && redHigh - redLow >= 50
      // Guard the vendor algorithm's signed 32-bit AC*DC intermediates.
      && uint64_t(redHigh - redLow) * high <= 1073741823ULL
      && uint64_t(high - low) * redHigh <= 1073741823ULL;
  }
 private:
  uint32_t reds[size] = {}, infrared[size] = {};
  unsigned cursor = 0, sinceCalculation = 0;
};
