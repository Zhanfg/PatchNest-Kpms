TARGET := patchnest-diagnostic-hello.kpm
SOURCE := diagnostic_hello.c
OBJECTS := diagnostic_hello.o
DEPFILES := diagnostic_hello.d
LINKER_SCRIPT := diagnostic_hello.lds
MAP_FILE := diagnostic_hello.map

ifneq ($(filter clean,$(MAKECMDGOALS)),clean)
ifndef TARGET_COMPILE
    $(error TARGET_COMPILE not set)
endif
ifndef KP_DIR
    $(error KP_DIR not set)
endif

CC := $(TARGET_COMPILE)gcc
INCLUDE_DIRS := . include patch/include linux/include linux/arch/arm64/include linux/tools/arch/arm64/include
INCLUDE_FLAGS := $(foreach dir,$(INCLUDE_DIRS),-I$(KP_DIR)/kernel/$(dir))
CFLAGS += -O2 -Wall -Wextra -Werror
endif

all: $(TARGET)

$(TARGET): $(OBJECTS) $(LINKER_SCRIPT)
	$(CC) -r -Wl,-T,$(LINKER_SCRIPT) -Wl,-Map,$(MAP_FILE) -o $@ $(OBJECTS)

diagnostic_hello.o: $(SOURCE)
	$(CC) $(CFLAGS) $(INCLUDE_FLAGS) -MMD -MF diagnostic_hello.d -c -o $@ $<

-include $(DEPFILES)

clean:
	rm -f $(OBJECTS) $(DEPFILES) $(MAP_FILE) $(TARGET)

.PHONY: all clean
