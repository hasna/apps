#!/usr/bin/env bun
/** Stage B deferred: Stage A never imports a cloud driver or reads a DSN. */
import { stopDeferredStageBOperation } from "./stage-a-deferred.js";

stopDeferredStageBOperation("migrate");
