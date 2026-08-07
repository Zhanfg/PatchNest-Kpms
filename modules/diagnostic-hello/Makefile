ifndef TARGET_COMPILE
    $(error TARGET_COMPILE not set)
endif

ifndef KP_DIR
    $(error KP_DIR not set)
endif

CC := $(TARGET_COMPILE)gcc
INCLUDE_DIRS := . include patch/include linux/include linux/arch/arm64/include linux/tools/arch/arm64/include
INCLUDE_FLAGS := $(foreach dir,$(INCLUDE_DIRS),-I$(KP_DIR)/kernel/$(dir))
CFLAGS += -O2 -Wall -Wextra -Werror -MMD -MP

TARGET := patchnest-diagnostic-hello.kpm
MAP := patchnest-diagnostic-hello.map
OBJECTS := diagnostic_hello.o
DEPS := $(OBJECTS:.o=.d)
LINKER_SCRIPT := diagnostic_hello.lds

all: $(TARGET)

$(TARGET): $(OBJECTS) $(LINKER_SCRIPT)
	$(CC) -r -Wl,-T,$(LINKER_SCRIPT) -Wl,-Map,$(MAP) -o $@ $(OBJECTS)

%.o: %.c
	$(CC) $(CFLAGS) $(INCLUDE_FLAGS) -c -o $@ $<

clean:
	rm -f $(OBJECTS) $(DEPS) $(TARGET) $(MAP)

-include $(DEPS)

.PHONY: all clean
