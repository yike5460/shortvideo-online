Handy commands to setup the container service:

```bash
docker stop $(docker ps -q) && docker rm $(docker ps -aq)
docker build -t qwen-vl:v4 .
docker run --detach --name qwen-service-v4 --restart unless-stopped --gpus all -p 8001:7860 qwen-vl:v4
docker logs -f qwen-service-v4
```

Command to test the container service:

```bash
curl -G "localhost:8001/predict" \
  --data-urlencode "url=https://cdn-uploads.huggingface.co/production/uploads/608aabf24955d2bfc3cd99c6/L02nWuPbsmgcdrUs8tx3q.png" \
  --data-urlencode "prompt=Describe this image." \
  --data-urlencode "input_type=image"


curl -G "localhost:8001/predict" \
  --data-urlencode "url=http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4" \
  --data-urlencode "prompt=Describe this video." \
  --data-urlencode "input_type=video" \
  --data-urlencode "fps=1.0" \
  --data-urlencode "max_frames=8"
  
curl -G "localhost:8001/predict" \
  --data-urlencode "url=s3://video-search-dev-ap-northeast-1/RawVideos/2025-05-12/chole/7176bf11-c08a-4e20-b051-80d2bb23710f/Snail.mp4" \
  --data-urlencode "prompt=Describe this video." \
  --data-urlencode "input_type=video" \
  --data-urlencode "fps=1.0" \
  --data-urlencode "max_frames=8"
```
