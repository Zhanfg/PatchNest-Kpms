NEEDS_TOOLCHAIN_GOALS := $(filter-out clean print-build-graph,$(MAKECMDGOALS))
ifeq ($(strip $(MAKECMDGOALS)),)
    NEEDS_TOOLCHAIN_GOALS := all
endif

ifneq ($(strip $(NEEDS_TOOLCHAIN_GOALS)),)
ifndef TARGET_COMPILE
    $(error TARGET_COMPILE not set)
endif
ifndef KP_DIR
    $(error KP_DIR not set)
endif
endif

CC := $(TARGET_COMPILE)gcc
READELF := $(TARGET_COMPILE)readelf
INCLUDE_DIRS := . include patch/include linux/include linux/arch/arm64/include linux/tools/arch/arm64/include
INCLUDE_FLAGS := $(foreach dir,$(INCLUDE_DIRS),-I$(KP_DIR)/kernel/$(dir))
CFLAGS := -O2 -Wall -Wextra -Werror=implicit-function-declaration -Werror=int-conversion
DEPFLAGS := -MMD -MP

TARGET := patchnest-diagnostic-hello.kpm
MAP := patchnest-diagnostic-hello.map
LINKER_SCRIPT := diagnostic_hello.lds
UPSTREAM_LINKER_SCRIPT := $(KP_DIR)/kpms/demo-hello/hello.lds
LINKER_SENTINELS := .plt .init.plt .text.ftrace_trampoline
SOURCES := diagnostic_hello.c
OBJECTS := $(SOURCES:.c=.o)
DEPS := $(OBJECTS:.o=.d)
LDFLAGS := -r -Wl,-T,$(LINKER_SCRIPT) -Wl,-Map,$(MAP)

all: $(TARGET)

$(TARGET): $(OBJECTS) $(LINKER_SCRIPT)
	@test -f "$(UPSTREAM_LINKER_SCRIPT)" || { echo "missing pinned upstream linker script: $(UPSTREAM_LINKER_SCRIPT)" >&2; exit 1; }
	@cmp "$(LINKER_SCRIPT)" "$(UPSTREAM_LINKER_SCRIPT)" || { echo "local linker script diverged from pinned upstream contract" >&2; exit 1; }
	$(CC) $(LDFLAGS) -o $@ $(OBJECTS)
	@for section in $(LINKER_SENTINELS); do \
		$(READELF) -SW $@ | awk -v section="$$section" 'BEGIN { found=0 } { for (i=1; i<=NF; i++) if ($$i == section) { found=1; size=$$(i + 4); if (size !~ /^0*1$$/) exit 2 } } END { if (!found) exit 1 }' || { \
			echo "linker sentinel contract failed for $$section" >&2; \
			exit 1; \
		}; \
	done

%.o: %.c
	$(CC) $(CFLAGS) $(DEPFLAGS) -MF $(@:.o=.d) $(INCLUDE_FLAGS) -c -o $@ $<

print-build-graph:
	@printf 'sources=%s\nobjects=%s\nlinker_script=%s\nlinker_sentinels=%s\ntarget=%s\nmap=%s\n' \
		'$(SOURCES)' '$(OBJECTS)' '$(LINKER_SCRIPT)' '$(LINKER_SENTINELS)' '$(TARGET)' '$(MAP)'

clean:
	rm -f $(OBJECTS) $(DEPS) $(TARGET) $(MAP)

-include $(DEPS)

.PHONY: all clean print-build-graph
