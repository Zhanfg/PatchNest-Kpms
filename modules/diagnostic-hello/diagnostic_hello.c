/* SPDX-License-Identifier: GPL-2.0-or-later */
/*
 * PatchNest diagnostic KPM.
 *
 * This module deliberately performs no hooks, filtering, hiding, policy
 * changes, or persistence. It exists only to verify the KPM SDK, loader,
 * control channel, unload path, and release provenance pipeline.
 *
 * Interface structure derived from KernelSU-Next/KPatch-Next demo-hello at
 * commit 0fe6d142266b80e5aa445a7ea1534f88a8f33a35.
 */

#include <compiler.h>
#include <kpmodule.h>
#include <linux/errno.h>
#include <linux/printk.h>
#include <common.h>
#include <kputils.h>

KPM_NAME("patchnest-diagnostic-hello");
KPM_VERSION("0.1.0");
KPM_LICENSE("GPL v2");
KPM_AUTHOR("PatchNest Maintainers");
KPM_DESCRIPTION("Non-invasive PatchNest KPM build and lifecycle diagnostic");

static long diagnostic_init(const char *args, const char *event, void *__user reserved)
{
    (void)args;
    (void)reserved;
    pr_info("patchnest diagnostic initialized, event=%s, kpver=%x\n", event, kpver);
    return 0;
}

static long diagnostic_control0(const char *args, char *__user out_msg, int outlen)
{
    static const char response[] = "patchnest-diagnostic-ok";
    const int response_size = (int)sizeof(response);

    (void)args;
    if (!out_msg || outlen < response_size) {
        return -ENOSPC;
    }
    if (compat_copy_to_user(out_msg, response, sizeof(response))) {
        return -EFAULT;
    }
    return response_size - 1;
}

static long diagnostic_exit(void *__user reserved)
{
    (void)reserved;
    pr_info("patchnest diagnostic unloaded\n");
    return 0;
}

KPM_INIT(diagnostic_init);
KPM_CTL0(diagnostic_control0);
KPM_EXIT(diagnostic_exit);
