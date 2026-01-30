import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { PID_FILE, REFERENCE_COUNT_FILE } from '@CCR/shared';
import { readConfigFile } from '.';
import http from 'http';

// Debug logging - enable with CCR_DEBUG=1
const DEBUG = process.env.CCR_DEBUG === '1';
function debug(msg: string) {
    if (DEBUG) {
        console.log(`[CCR DEBUG] ${msg}`);
    }
}

// HTTP health check - the sole method for checking if service is running
function checkServerHealth(port: number): Promise<boolean> {
    debug(`HTTP health check on port ${port}`);
    return new Promise((resolve) => {
        let resolved = false;
        const safeResolve = (value: boolean) => {
            if (!resolved) {
                resolved = true;
                resolve(value);
            }
        };

        // Overall timeout including connection time (covers connection delays)
        const overallTimeout = setTimeout(() => {
            debug(`HTTP health check timeout`);
            req.destroy();
            safeResolve(false);
        }, 3000);

        const req = http.request(
            { hostname: '127.0.0.1', port, path: '/health', method: 'GET' },
            (res) => {
                clearTimeout(overallTimeout);
                debug(`HTTP health check response: ${res.statusCode}`);
                // Consume response body to prevent memory leaks
                res.resume();
                safeResolve(res.statusCode === 200);
            }
        );
        req.on('error', (err) => {
            clearTimeout(overallTimeout);
            debug(`HTTP health check error: ${err.message}`);
            safeResolve(false);
        });
        req.end();
    });
}

export function incrementReferenceCount() {
    let count = 0;
    if (existsSync(REFERENCE_COUNT_FILE)) {
        count = parseInt(readFileSync(REFERENCE_COUNT_FILE, 'utf-8')) || 0;
    }
    count++;
    writeFileSync(REFERENCE_COUNT_FILE, count.toString());
}

export function decrementReferenceCount() {
    let count = 0;
    if (existsSync(REFERENCE_COUNT_FILE)) {
        count = parseInt(readFileSync(REFERENCE_COUNT_FILE, 'utf-8')) || 0;
    }
    count = Math.max(0, count - 1);
    writeFileSync(REFERENCE_COUNT_FILE, count.toString());
}

export function getReferenceCount(): number {
    if (!existsSync(REFERENCE_COUNT_FILE)) {
        return 0;
    }
    return parseInt(readFileSync(REFERENCE_COUNT_FILE, 'utf-8')) || 0;
}

export async function isServiceRunning(): Promise<boolean> {
    debug(`isServiceRunning() called`);

    try {
        const config = await readConfigFile();
        const port = config.PORT || 3456;
        const healthy = await checkServerHealth(port);
        if (healthy) {
            debug(`Service running (HTTP health check passed)`);
            return true;
        }
    } catch (e) {
        debug(`Error during health check: ${e}`);
    }

    debug(`Service not running`);
    return false;
}

export function savePid(pid: number) {
    writeFileSync(PID_FILE, pid.toString());
}

export function cleanupPidFile() {
    if (existsSync(PID_FILE)) {
        try {
            unlinkSync(PID_FILE);
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

export function getServicePid(): number | null {
    if (!existsSync(PID_FILE)) {
        return null;
    }

    try {
        const pid = parseInt(readFileSync(PID_FILE, 'utf-8'));
        return isNaN(pid) ? null : pid;
    } catch (e) {
        return null;
    }
}

export async function getServiceInfo() {
    const pid = getServicePid();
    const running = await isServiceRunning();
    const config = await readConfigFile();
    const port = config.PORT || 3456;

    return {
        running,
        pid,
        port,
        endpoint: `http://127.0.0.1:${port}`,
        pidFile: PID_FILE,
        referenceCount: getReferenceCount()
    };
}

export function closeService() {
    // Check reference count
    const referenceCount = getReferenceCount();

    // Only stop the service if reference count is 0
    if (referenceCount === 0) {
        const pid = getServicePid();
        if (pid) {
            try {
                // Try to kill the service process
                // In jailroot/container environments, this may fail (ESRCH)
                // because the PID is in a different namespace - that's OK
                process.kill(pid, 'SIGTERM');
            } catch (e) {
                // Ignore kill errors (process may already be gone or in different namespace)
            }
        }
    }
}
