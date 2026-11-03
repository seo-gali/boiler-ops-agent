import asyncio
import json
import logging
import uuid
import time

from aiokafka import AIOKafkaConsumer
from aiokafka.errors import KafkaError
from aiokafka.admin import AIOKafkaAdminClient
from aiokafka.structs import TopicPartition, OffsetAndMetadata

from backend.app.streaming.topic import ensure_topic
from backend.app.streaming.security import kafka_options

logger = logging.getLogger(__name__)


async def consume(settings, state, hub):
    options = kafka_options("consumer", settings.brokers)
    group = f"boiler-monitor-{uuid.uuid4()}"
    while True:
        consumer = None
        admin = None
        try:
            await ensure_topic(settings)
            consumer = AIOKafkaConsumer(settings.topic, bootstrap_servers=settings.brokers,
                                        group_id=group, auto_offset_reset="earliest", enable_auto_commit=False,
                                        request_timeout_ms=5000, session_timeout_ms=6000,
                                        heartbeat_interval_ms=1000, max_partition_fetch_bytes=262144, **options)
            await consumer.start()
            admin = AIOKafkaAdminClient(bootstrap_servers=settings.brokers, request_timeout_ms=2000, **options)
            await admin.start()
            checked = 0
            state.kafka = "CONNECTED"
            while True:
                if time.monotonic() - checked > 1:
                    # 연결 정리 전 두 읽기의 완료 보장.
                    batches, metadata = await asyncio.gather(
                        consumer.getmany(timeout_ms=500, max_records=50),
                        admin.describe_topics([settings.topic]), return_exceptions=True)
                    for result in (batches, metadata):
                        if isinstance(result, BaseException):
                            raise result
                    checked = time.monotonic()
                else:
                    batches = await consumer.getmany(timeout_ms=500, max_records=50)
                state.kafka = "CONNECTED"
                for messages in batches.values():
                    for message in messages:
                        try:
                            if len(message.value) > 65536:
                                raise ValueError("Telemetry record exceeds size limit")
                            state.apply(json.loads(message.value), message.offset)
                        except (ValueError, TypeError, UnicodeDecodeError) as error:
                            state.rejected += 1
                            state.error = f"Rejected Kafka offset {message.offset}: {error}"
                            logger.error(state.error)
                        else:
                            await consumer.commit({TopicPartition(message.topic, message.partition): OffsetAndMetadata(message.offset + 1, "")})
                        hub.publish(state.snapshot())
        except (KafkaError, OSError, ValueError) as error:
            state.kafka = "DISCONNECTED"
            state.error = f"Kafka consumer: {type(error).__name__}: {error}"
            logger.warning(state.error)
            hub.publish(state.snapshot())
            await asyncio.sleep(1)
        finally:
            if admin is not None:
                await admin.close()
            if consumer is not None:
                await consumer.stop()
