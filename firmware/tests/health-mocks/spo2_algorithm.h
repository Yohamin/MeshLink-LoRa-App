#pragma once
#include <stdint.h>
inline void maxim_heart_rate_and_oxygen_saturation(uint32_t *, int, uint32_t *,
    int32_t *oxygen, int8_t *oxygenValid, int32_t *heart, int8_t *heartValid) {
  *oxygen = 97; *oxygenValid = 1; *heart = 72; *heartValid = 1;
}
