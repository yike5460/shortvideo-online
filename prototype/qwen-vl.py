import json  
from openai import OpenAI

client = OpenAI(
    api_key="sk-1234567890", # Get from https://cloud.siliconflow.cn/account/
    base_url="https://api.siliconflow.cn/v1"
)

# Example 1: Using a video URL
def infer_with_video_url(video_url, prompt, min_pixels=None, max_pixels=None, total_pixels=None, fps=None):
    video_content = {
        "type": "video",
        "video": video_url,
    }
    
    # Add optional parameters if provided
    if min_pixels is not None:
        video_content["min_pixels"] = min_pixels
    if max_pixels is not None:
        video_content["max_pixels"] = max_pixels
    if total_pixels is not None:
        video_content["total_pixels"] = total_pixels
    if fps is not None:
        video_content["fps"] = fps
    
    response = client.chat.completions.create(
        model="Qwen/Qwen2-VL-72B-Instruct",
        messages=[
            {
                "role": "user",
                "content": [
                    video_content,
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ],
        stream=True
    )
    
    for chunk in response:
        chunk_message = chunk.choices[0].delta.content
        print(chunk_message, end='', flush=True)

# Example 2: Using a local video file
def infer_with_local_video(video_path, prompt, max_pixels=None, fps=None):
    video_content = {
        "type": "video",
        "video": f"file://{video_path}",
    }
    
    # Add optional parameters if provided
    if max_pixels is not None:
        video_content["max_pixels"] = max_pixels
    if fps is not None:
        video_content["fps"] = fps
    
    response = client.chat.completions.create(
        model="Qwen/Qwen2-VL-72B-Instruct",
        messages=[
            {
                "role": "user",
                "content": [
                    video_content,
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ],
        # stream=True
    )
    
    for chunk in response:
        chunk_message = chunk.choices[0].delta.content
        print(chunk_message, end='', flush=True)

# Example 3: Using a list of frames as a video
def infer_with_frame_list(frame_paths, prompt):
    video_content = {
        "type": "video",
        "video": [f"file://{frame_path}" for frame_path in frame_paths],
    }
    
    response = client.chat.completions.create(
        model="Qwen/Qwen2-VL-72B-Instruct",
        messages=[
            {
                "role": "user",
                "content": [
                    video_content,
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ],
        stream=True
    )
    
    for chunk in response:
        chunk_message = chunk.choices[0].delta.content
        print(chunk_message, end='', flush=True)

# For backward compatibility, keep the original image inference code
def infer_with_image(image_url, prompt):
    response = client.chat.completions.create(
        model="Qwen/Qwen2-VL-72B-Instruct",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_url
                        }
                    },
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ],
        stream=True
    )
    
    for chunk in response:
        chunk_message = chunk.choices[0].delta.content
        print(chunk_message, end='', flush=True)

# Example usage
if __name__ == "__main__":
    # Example with image (original functionality)
    # infer_with_image(
    #     "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/dog.png",
    #     "请描述这张图片的内容"
    # )
    
    # Examples for video inference can be uncommented and used as needed:
    
    # Example with video URL
    # infer_with_video_url(
    #     "https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen2-VL/space_woaudio.mp4",
    #     "Describe this video.",
    #     min_pixels=4 * 28 * 28,
    #     max_pixels=256 * 28 * 28,
    #     total_pixels=20480 * 28 * 28
    # )
    
    # Example with local video file
    infer_with_local_video(
        "/Users/kyiamzn/03_code/shortvideo-online/prototype/nova/media/短片3.mp4",
        "Describe this video.",
        max_pixels=360 * 420,
        fps=1.0
    )
    
    # Example with frame list
    # infer_with_frame_list(
    #     [
    #         "/path/to/frame1.jpg",
    #         "/path/to/frame2.jpg",
    #         "/path/to/frame3.jpg",
    #         "/path/to/frame4.jpg"
    #     ],
    #     "Describe this video."
    # )