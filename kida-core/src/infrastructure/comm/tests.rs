// Must implement module tests here! Do not implement tests inside source files!
#[tokio::test]
async fn system_commands_through_unix_socket() {
    use std::time::Duration;

    use serde_json::{Value, json};
    use tokio::{
        io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
        net::UnixStream,
        time::{sleep, timeout},
    };

    use super::transport::unix::UnixSocketServer;

    let path = std::env::temp_dir().join(format!("kida-system-{}.sock", uuid::Uuid::new_v4(),));
    let server = UnixSocketServer::new(path.to_str().unwrap());

    let task = tokio::spawn(async move { server.start().await });

    let stream = timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(stream) = UnixStream::connect(&path).await {
                break stream;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("UNIX server did not become available");

    let mut connection = BufReader::new(stream);

    for (command, params, expected_status) in [
        ("system.wake_capabilities", json!({}), "OK"),
        (
            "system.power_cycle",
            json!({"wake_after_seconds": 119}),
            "ERROR",
        ),
    ] {
        let request = json!({
            "id": "unix-system-check",
            "command": command,
            "params": params,
        });

        let mut encoded = serde_json::to_vec(&request).unwrap();
        encoded.push(b'\n');
        connection.get_mut().write_all(&encoded).await.unwrap();

        let mut line = String::new();
        let received = timeout(Duration::from_secs(5), connection.read_line(&mut line))
            .await
            .expect("UNIX response timed out")
            .unwrap();

        assert!(received > 0);

        let response: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(response["id"], "unix-system-check");
        assert_eq!(response["status"], expected_status);

        if expected_status == "OK" {
            assert_eq!(response["data"]["s5_wake_status"], "unverified");
            assert!(response["data"]["warnings"].is_array());
            assert!(response.get("error").is_none());
        } else {
            assert!(
                response["error"]
                    .as_str()
                    .is_some_and(|error| !error.is_empty())
            );
            assert!(response.get("data").is_none());
        }
    }

    drop(connection);
    task.abort();
    let _ = task.await;
    std::fs::remove_file(&path).unwrap();
}

#[tokio::test]
async fn system_commands_through_http() {
    use std::time::Duration;

    use serde_json::{Value, json};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
        time::{sleep, timeout},
    };

    use super::transport::http::HttpServer;

    let reservation = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = reservation.local_addr().unwrap();
    drop(reservation);

    let server = HttpServer::new("127.0.0.1", address.port());
    let task = tokio::spawn(async move { server.start().await });

    for (command, params, expected_status) in [
        ("system.wake_capabilities", json!({}), "OK"),
        (
            "system.power_cycle",
            json!({"wake_after_seconds": 119}),
            "ERROR",
        ),
    ] {
        let request = json!({
            "id": "http-system-check",
            "command": command,
            "params": params,
        });
        let body = serde_json::to_string(&request).unwrap();
        let wire_request = format!(
            "POST /command HTTP/1.1\r\n\
             Host: {address}\r\n\
             Content-Type: application/json\r\n\
             Content-Length: {}\r\n\
             Connection: close\r\n\r\n{body}",
            body.len(),
        );

        let received = timeout(Duration::from_secs(5), async {
            let mut connection = loop {
                match TcpStream::connect(address).await {
                    Ok(connection) => break connection,
                    Err(_) => {
                        assert!(!task.is_finished(), "HTTP server stopped");
                        sleep(Duration::from_millis(10)).await;
                    }
                }
            };

            connection.write_all(wire_request.as_bytes()).await.unwrap();

            let mut response = Vec::new();
            connection.read_to_end(&mut response).await.unwrap();
            response
        })
        .await
        .expect("HTTP exchange timed out");

        let received = String::from_utf8(received).unwrap();
        let (headers, body) = received.split_once("\r\n\r\n").unwrap();

        assert!(headers.starts_with("HTTP/1.1 200 "));

        let response: Value = serde_json::from_str(body).unwrap();
        assert_eq!(response["id"], "http-system-check");
        assert_eq!(response["status"], expected_status);

        if expected_status == "OK" {
            assert_eq!(response["data"]["s5_wake_status"], "unverified");
            assert!(response["data"]["warnings"].is_array());
            assert!(response.get("error").is_none());
        } else {
            assert!(
                response["error"]
                    .as_str()
                    .is_some_and(|error| !error.is_empty())
            );
            assert!(response.get("data").is_none());
        }
    }

    task.abort();
    let _ = task.await;
}

// Uses the runtime initialized by the worker integration test to exercise the real dispatcher.
pub(crate) async fn scheduler_protection_through_transports() {
    use super::transport::{http::HttpServer, unix::UnixSocketServer};
    use crate::features::scheduler::{
        model::{NewSchedule, ScheduleOriginFilter, ScheduleRule},
        runtime,
    };
    use serde_json::{Value, json};
    use std::time::Duration;
    use tokio::{
        io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
        net::{TcpStream, UnixStream},
        time::{sleep, timeout},
    };

    let manager = runtime::manager().unwrap();
    let internal = manager
        .add_internal(NewSchedule {
            command: "scheduler.list".into(),
            params: json!({"nested":[null,true]}),
            schedule: ScheduleRule::Interval { seconds: 3600 },
        })
        .unwrap();
    let id = internal["id"].as_str().unwrap();
    let before = manager.list_by_origin(ScheduleOriginFilter::All).unwrap();
    let path = &crate::conf::get().unwrap().scheduler.path;
    let original = std::fs::read_to_string(path).unwrap();
    let socket = std::env::temp_dir().join(format!("kida-protected-{}.sock", uuid::Uuid::new_v4()));
    let server = UnixSocketServer::new(socket.to_str().unwrap());
    let unix_task = tokio::spawn(async move { server.start().await });
    let reservation = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = reservation.local_addr().unwrap();
    drop(reservation);
    let server = HttpServer::new("127.0.0.1", address.port());
    let http_task = tokio::spawn(async move { server.start().await });

    for http in [false, true] {
        for (command, params, expected_status, expected_data) in [
            ("scheduler.delete", json!({"id":id}), "ERROR", None),
            (
                "scheduler.delete",
                json!({"id":id,"origin":"INTERNAL"}),
                "ERROR",
                None,
            ),
            (
                "scheduler.add",
                json!({"origin":"INTERNAL","command":"scheduler.list","params":null,"schedule":{"type":"interval","seconds":60}}),
                "ERROR",
                None,
            ),
            ("scheduler.list", json!({"origin":"invalid"}), "ERROR", None),
            (
                "scheduler.list",
                json!({}),
                "OK",
                Some(manager.list().unwrap()),
            ),
            (
                "scheduler.list",
                Value::Null,
                "OK",
                Some(manager.list().unwrap()),
            ),
            (
                "scheduler.list",
                json!({"origin":"INTERNAL"}),
                "OK",
                Some(
                    manager
                        .list_by_origin(ScheduleOriginFilter::Internal)
                        .unwrap(),
                ),
            ),
            (
                "scheduler.list",
                json!({"origin":"ALL"}),
                "OK",
                Some(before.clone()),
            ),
        ] {
            let request = json!({"id":"protected-check","command":command,"params":params});
            let response: Value = timeout(Duration::from_secs(5), async {
                if http {
                    let mut stream = loop {
                        if let Ok(stream) = TcpStream::connect(address).await { break stream; }
                        assert!(!http_task.is_finished(), "HTTP server stopped");
                        sleep(Duration::from_millis(10)).await;
                    };
                    let body = request.to_string();
                    let wire = format!("POST /command HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    stream.write_all(wire.as_bytes()).await.unwrap();
                    let mut response = String::new();
                    stream.read_to_string(&mut response).await.unwrap();
                    let (headers, body) = response.split_once("\r\n\r\n").unwrap();
                    assert!(headers.starts_with("HTTP/1.1 200 "));
                    serde_json::from_str(body).unwrap()
                } else {
                    let stream = loop {
                        if let Ok(stream) = UnixStream::connect(&socket).await { break stream; }
                        assert!(!unix_task.is_finished(), "UNIX server stopped");
                        sleep(Duration::from_millis(10)).await;
                    };
                    let mut stream = BufReader::new(stream);
                    stream.get_mut().write_all(format!("{request}\n").as_bytes()).await.unwrap();
                    let mut line = String::new();
                    stream.read_line(&mut line).await.unwrap();
                    serde_json::from_str(&line).unwrap()
                }
            }).await.expect("scheduler transport exchange timed out");
            assert_eq!(response["id"], "protected-check");
            assert_eq!(response["status"], expected_status, "{response}");
            if let Some(data) = expected_data {
                assert_eq!(response["data"], data);
            } else {
                assert!(
                    response["error"]
                        .as_str()
                        .is_some_and(|error| !error.is_empty())
                );
            }
            assert_eq!(
                manager.list_by_origin(ScheduleOriginFilter::All).unwrap(),
                before
            );
            assert_eq!(std::fs::read_to_string(path).unwrap(), original);
        }
    }
    unix_task.abort();
    http_task.abort();
    let _ = unix_task.await;
    let _ = http_task.await;
    std::fs::remove_file(socket).unwrap();
    manager.delete_internal(id).unwrap();
}
