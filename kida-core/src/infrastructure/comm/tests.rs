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
