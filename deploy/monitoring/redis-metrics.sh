#!/usr/bin/env bash
# Publishes Redis health and memory to CloudWatch through the CloudWatch agent's local EMF listener
# (UDP 127.0.0.1:25888; enabled by the /fenwira/prod/config/cloudwatch-agent-extra parameter).
# Run every minute by fenwira-redis-metrics.timer. Prints nothing on success.
#   redis_up                   1 if PING answers, else 0 (a stopped timer shows up as missing data)
#   redis_used_memory_bytes    INFO used_memory (what maxmemory is enforced against)
#   redis_used_memory_percent  used_memory / maxmemory × 100 (writes are refused at 100: noeviction)
#   worker_up                  1 if the worker's /health/live answers, else 0 (ADR-0027 item E)
#   queue_backlog_age_seconds  age of the oldest waiting job across the queues that carry customer
#                              traffic (BullMQ wait lists: LPUSH, so the oldest is the tail)
set -euo pipefail

QUEUES=(whatsapp.inbound whatsapp.status whatsapp.outbound campaign.dispatch automation.execute
  notifications.dispatch identity.events tenancy.events webhooks.deliver)

instance_id="$(cat /var/lib/cloud/data/instance-id)"
up=0 used=0 percent=0
if [[ "$(redis-cli -h 127.0.0.1 PING 2>/dev/null)" == "PONG" ]]; then
  up=1
  info="$(redis-cli -h 127.0.0.1 INFO memory | tr -d '\r')"
  used="$(awk -F: '/^used_memory:/{print $2}' <<<"$info")"
  max="$(awk -F: '/^maxmemory:/{print $2}' <<<"$info")"
  if [[ "${max:-0}" -gt 0 ]]; then percent="$(awk -v u="$used" -v m="$max" 'BEGIN{printf "%.2f", u*100/m}')"; fi
fi

worker_up=0
curl -fsS -m 3 -o /dev/null http://127.0.0.1:4100/health/live 2>/dev/null && worker_up=1
backlog=0
if [[ "$up" == 1 ]]; then
  now_ms="$(($(date +%s) * 1000))"
  for q in "${QUEUES[@]}"; do
    id="$(redis-cli -h 127.0.0.1 LINDEX "bull:${q}:wait" -1 2>/dev/null | tr -d '\r')"
    [[ -n "$id" ]] || continue
    ts="$(redis-cli -h 127.0.0.1 HGET "bull:${q}:${id}" timestamp 2>/dev/null | tr -d '\r')"
    [[ "$ts" =~ ^[0-9]+$ ]] || continue
    age=$(((now_ms - ts) / 1000))
    ((age > backlog)) && backlog=$age
  done
fi

printf '{"_aws":{"Timestamp":%s,"LogGroupName":"/fenwira/v2/prod/system","LogStreamName":"redis-metrics-%s","CloudWatchMetrics":[{"Namespace":"CWAgent","Dimensions":[["InstanceId"]],"Metrics":[{"Name":"redis_up","Unit":"Count"},{"Name":"redis_used_memory_bytes","Unit":"Bytes"},{"Name":"redis_used_memory_percent","Unit":"Percent"},{"Name":"worker_up","Unit":"Count"},{"Name":"queue_backlog_age_seconds","Unit":"Seconds"}]}]},"InstanceId":"%s","redis_up":%s,"redis_used_memory_bytes":%s,"redis_used_memory_percent":%s,"worker_up":%s,"queue_backlog_age_seconds":%s}\n' \
  "$(($(date +%s) * 1000))" "$instance_id" "$instance_id" "$up" "${used:-0}" "$percent" "$worker_up" "$backlog" |
  nc -u -w1 127.0.0.1 25888
