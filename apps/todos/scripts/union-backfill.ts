#!/usr/bin/env bun
/** Stage B deferred: Stage A never opens SQLite or sends an import request. */
import { stopDeferredStageBOperation } from "./stage-a-deferred.js";

stopDeferredStageBOperation("union-backfill");
