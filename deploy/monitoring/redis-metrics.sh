#!/usr/bin/env bash
# Publishes Redis health and memory to CloudWatch through the CloudWatch agent's local EMF listener
# (UDP 127.0.0.1:25888; enabled by the /fenwira/prod/config/cloudwatch-agent-extra parameter).
# Run every minute by fenwira-redis-metrics.timer. Prints nothing on success.
#   redis_up                   1 if PING answers, else 0 (a stopped timer shows up as missing data)
#   redis_used_memory_bytes    INFO used_memory (what maxmemory is enforced against)
#   redis_used_memory_percent  used_memory / maxmemory × 100 (writes are refused at 100: noeviction)
set -euo pipefail

instance_id="$(cat /var/lib/cloud/data/instance-id)"
up=0 used=0 percent=0
if [[ "$(redis-cli -h 127.0.0.1 PING 2>/dev/null)" == "PONG" ]]; then
  up=1
  info="$(redis-cli -h 127.0.0.1 INFO memory | tr -d '\r')"
  used="$(awk -F: '/^used_memory:/{print $2}' <<<"$info")"
  max="$(awk -F: '/^maxmemory:/{print $2}' <<<"$info")"
  if [[ "${max:-0}" -gt 0 ]]; then percent="$(awk -v u="$used" -v m="$max" 'BEGIN{printf "%.2f", u*100/m}')"; fi
fi

printf '{"_aws":{"Timestamp":%s,"LogGroupName":"/fenwira/v2/prod/system","LogStreamName":"redis-metrics-%s","CloudWatchMetrics":[{"Namespace":"CWAgent","Dimensions":[["InstanceId"]],"Metrics":[{"Name":"redis_up","Unit":"Count"},{"Name":"redis_used_memory_bytes","Unit":"Bytes"},{"Name":"redis_used_memory_percent","Unit":"Percent"}]}]},"InstanceId":"%s","redis_up":%s,"redis_used_memory_bytes":%s,"redis_used_memory_percent":%s}\n' \
  "$(($(date +%s) * 1000))" "$instance_id" "$instance_id" "$up" "${used:-0}" "$percent" |
  nc -u -w1 127.0.0.1 25888
